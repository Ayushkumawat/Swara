import "server-only";
import { getDb, nowIso } from "./db";
import { provisionWorkspace, resetVoices } from "./workspace";

/**
 * The three destructive things an owner can do from the profile menu, each
 * one transaction, each scoped to one org.
 *
 *  - eraseCallHistory: every trace of every call, so the agents are exactly
 *    as designed but have never spoken to anyone. This is what makes
 *    re-testing from the same phone number honest: the "you already filed
 *    #1234" memory lives in customers/complaints keyed by phone, and goes.
 *  - resetWorkspace: the above plus everything Swara or the owner built —
 *    agents, knowledge, departments, desks, booking types, campaigns,
 *    connectors, voice edits. Back to a freshly provisioned org. Numbers,
 *    team, API keys and billing history stay.
 *  - deleteAccount: removes the user; if they were the only member, the
 *    whole org with them.
 */

const CALL_TABLES_IN_ORDER = [
  // Children before parents — foreign keys are on. timeline_events hangs off
  // customers without an org_id of its own and is handled separately.
  "ticket_messages",
  "actions",
  "complaints",
  "consent_artefacts",
  "recordings",
  "tool_invocations",
  "usage_events",
  "notifications",
  "bookings",
  "calls",
  "customers",
] as const;

export function eraseCallHistory(orgId: string, byUserId: string | null) {
  const d = getDb();
  const run = d.transaction(() => {
    const counts = eraseCallHistoryInside(d, orgId);
    // Campaigns keep their contact lists but forget every attempt.
    d.prepare(
      "UPDATE campaign_contacts SET status='queued', last_attempt_at=NULL, notes=NULL WHERE org_id=?",
    ).run(orgId);
    d.prepare("UPDATE campaigns SET dialed=0, connected=0 WHERE org_id=?").run(orgId);
    d.prepare("INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, ?, 'erase_calls', ?, ?)").run(
      orgId,
      byUserId,
      `${counts.calls} calls, ${counts.complaints} tickets, ${counts.customers} customers erased`,
      nowIso(),
    );
    return counts;
  });
  return run();
}

export function resetWorkspace(orgId: string, byUserId: string | null) {
  const d = getDb();
  const run = d.transaction(() => {
    const calls = eraseCallHistoryInside(d, orgId);

    const agents = d.prepare("DELETE FROM agents WHERE org_id=?").run(orgId).changes;
    d.prepare("DELETE FROM agent_versions WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM knowledge_chunks WHERE doc_id IN (SELECT id FROM knowledge_docs WHERE org_id=?)").run(orgId);
    d.prepare("DELETE FROM knowledge_docs WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM campaign_contacts WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM campaigns WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM transfer_targets WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM appointment_types WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM webhook_events WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM connectors WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM dlt_templates WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM config_blobs WHERE org_id=?").run(orgId);
    d.prepare("UPDATE numbers SET assigned_agent_id=NULL, assigned_agent_name=NULL WHERE org_id=?").run(orgId);

    // Departments go last among the owned rows: users and desks point at them.
    d.prepare("UPDATE users SET department_id=NULL WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM departments WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM workspace_playbook WHERE org_id=?").run(orgId);

    // Back to what a brand-new org gets: "General", the voice catalog, an
    // empty playbook.
    resetVoices(orgId);
    provisionWorkspace(orgId);

    d.prepare("INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, ?, 'reset_workspace', ?, ?)").run(
      orgId,
      byUserId,
      `${agents} agents and ${calls.calls} calls removed; workspace re-provisioned`,
      nowIso(),
    );
    return { agents, calls: calls.calls };
  });
  return run();
}

function eraseCallHistoryInside(d: ReturnType<typeof getDb>, orgId: string) {
  const counts: Record<string, number> = {};
  d.prepare("DELETE FROM timeline_events WHERE customer_id IN (SELECT id FROM customers WHERE org_id=?)").run(orgId);
  for (const table of CALL_TABLES_IN_ORDER) {
    counts[table] = d.prepare(`DELETE FROM ${table} WHERE org_id=?`).run(orgId).changes;
  }
  return counts;
}

export type DeleteAccountResult =
  | { ok: true; orgDeleted: boolean }
  | { ok: false; error: string };

export function deleteAccount(userId: string): DeleteAccountResult {
  const d = getDb();
  const user = d.prepare("SELECT id, org_id, role FROM users WHERE id=?").get(userId) as
    | { id: string; org_id: string; role: string }
    | undefined;
  if (!user) return { ok: false, error: "No such user" };

  const members = d.prepare("SELECT id, role FROM users WHERE org_id=?").all(user.org_id) as { id: string; role: string }[];
  const others = members.filter((m) => m.id !== userId);

  if (others.length > 0 && user.role === "owner" && !others.some((m) => m.role === "owner")) {
    return {
      ok: false,
      error: "You are the only owner. Make someone else an owner in Settings → Team first, or remove the other members.",
    };
  }

  const run = d.transaction(() => {
    d.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
    d.prepare("UPDATE audit_log SET user_id=NULL WHERE user_id=?").run(userId);

    if (others.length > 0) {
      d.prepare("DELETE FROM users WHERE id=?").run(userId);
      d.prepare("INSERT INTO audit_log (org_id, user_id, event, detail, at) VALUES (?, NULL, 'delete_user', ?, ?)").run(
        user.org_id, `user ${userId} deleted their account`, nowIso(),
      );
      return false;
    }

    // Sole member: the org goes with them. Everything owned by the org, in
    // dependency order, then the org row itself.
    const orgId = user.org_id;
    eraseCallHistoryInside(d, orgId);
    d.prepare("DELETE FROM knowledge_chunks WHERE doc_id IN (SELECT id FROM knowledge_docs WHERE org_id=?)").run(orgId);
    for (const table of [
      "agent_versions", "agents", "knowledge_docs", "campaign_contacts", "campaigns",
      "transfer_targets", "appointment_types", "webhook_events", "connectors", "dlt_templates", "config_blobs",
      "numbers", "sip_trunks", "payments", "invoices", "api_keys", "invites", "voices", "workspace_playbook",
    ]) {
      d.prepare(`DELETE FROM ${table} WHERE org_id=?`).run(orgId);
    }
    d.prepare("DELETE FROM users WHERE id=?").run(userId);
    d.prepare("DELETE FROM departments WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM audit_log WHERE org_id=?").run(orgId);
    d.prepare("DELETE FROM orgs WHERE id=?").run(orgId);
    return true;
  });

  return { ok: true, orgDeleted: run() };
}
