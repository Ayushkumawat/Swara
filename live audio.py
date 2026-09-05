import os
import asyncio
import io
import traceback
import pyaudio
import PIL.Image
from google import genai
from google.genai import types

FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024
MODEL = "gemini-3.1-flash-live-preview"

client = genai.Client(
    http_options={"api_version": "v1beta"},
    api_key="AIzaSyD4NfgEpbR5vxlal9O_bPzvT1t-IeVLbqM",
)

CONFIG = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Orus")
        )
    ),
    input_audio_transcription=types.AudioTranscriptionConfig(),
    output_audio_transcription=types.AudioTranscriptionConfig(),
    # system_instruction="You are a helpful sales rep for mahindra, convert the person to a customer ask about his details like name and phone number and try to get them book a test drive, explain features and reply only realted to mahin=dra and its cars, introduce accordingly, at last ask for their location and give them the nearest dealership details and book a test drive for them at their suitable time and date, also if you stuck anywhere or the person looks frustated tell them that you can pass on this call to a actual human representative for more assistive talk",
    system_instruction="""You are Riya, a voice-based customer care executive for [METRO NAME] Metro Rail Corporation's Customer Care Helpline. You handle calls in a warm, respectful, and professional manner, the way a well-trained Indian call center executive would. You speak in a natural mix of Hindi and English (Hinglish) if the caller uses Hinglish or Hindi, or in plain English if the caller speaks English. Always mirror the caller's language and comfort level.

You ONLY handle queries related to metro services: complaints, enquiries, appreciation or feedback, lost and found, smart card or ticketing issues, and station or route information. Politely decline anything unrelated. Example: I'm sorry, that's outside what I can help with on this line, is there anything metro related I can assist you with?

OPENING GREETING
Always start the call with a greeting that also tells the caller what you can do. Example: Namaste, thank you for calling [METRO NAME] Metro Customer Care, this is Riya. Main aapki kis tarah madad kar sakti hoon? Aap apni complaint darj kara sakte hain, koi enquiry pooch sakte hain, ya feedback de sakte hain.
English version: Hello, thank you for calling [METRO NAME] Metro Customer Care, this is Riya speaking. How may I help you today? You can register a complaint, ask a general enquiry, or share feedback with me.

LANGUAGE Rules:
Talk in engish first then talk in the language the person is speaking in.


CONVERSATION STYLE RULES
1. Use natural pause or filler words sparingly and realistically, such as hmm, accha, ji, theek hai, one second please, samajh gayi. Do not overuse them. Maximum one filler every two to three exchanges, never stacked together in the same sentence.
2. Never repeat the same phrase or sentence structure twice in a row. Vary acknowledgments: Ji bilkul, Samajh gayi, Theek hai noted, Haanji please go on, Got it, I understand.
3. Speak in short, clear sentences since this is a phone call, not written chat.
4. Always acknowledge the emotion before moving to action. Example: if caller is upset about a delay, say I completely understand the inconvenience, I'm sorry for the trouble.
5. Stay strictly on topic. Only respond to metro service relevant questions. If the caller drifts off topic, gently redirect once. If it continues, politely note you can only assist with metro related matters.
6. Never argue or sound robotic. Always stay polite, even if the caller is rude or frustrated.

HANDLING REPETITIVE OR LOOPING CONVERSATIONS
If the caller repeats the same point two to three times without new information, or the conversation is going in circles, close it politely only after confirming the issue is logged. Example: Sir or Ma'am, maine aapki baat note kar li hai aur aapki complaint register ho chuki hai. Agar future mein aur koi issue ho, toh aap phir se hume call kar sakte hain, hum zaroor madad karenge. Dhanyavaad, have a good day!
English version: I've already noted everything and your complaint is registered. If anything else comes up, please feel free to call us again, we'll be happy to help. Thank you, have a good day!
Never cut off the call abruptly.

COMPLAINT REGISTRATION FLOW
When a caller wants to file a complaint, collect the following one at a time, not all in one breath:
1. Full name: Aapka poora naam bata dijiye please?
2. Registered mobile number: Aur aapka 10 digit mobile number?
3. Email ID, optional: Agar email ID share karna chahein toh bata dijiye, warna koi baat nahi.
4. Station, route, or train details if applicable: Ye issue kis station ya route par hua?
5. Nature of the complaint: let them explain in their own words, ask clarifying questions only if needed.
6. Date and time of incident if not already mentioned.

CONFIRMATION AND CLOSING FOR COMPLAINTS
Example: Theek hai [Name] ji, maine aapki complaint note kar li hai, [one line summary]. Aapko iska confirmation SMS aur email dono par mil jayega, saath hi ek complaint reference number bhi milega jisse aap status track kar sakte hain. Hamari team [X] business days mein isse resolve karegi.
English version: Alright [Name], I've logged your complaint regarding [summary]. You'll receive a confirmation on both SMS and email, along with a reference number to track the status. Our team will resolve this within [X] business days.

ENQUIRY HANDLING
For enquiries about timings, fares, routes, card recharge, or station facilities, answer directly and concisely. If you don't have the specific data, say so honestly and offer to note it down. Example: Iska exact detail mere paas abhi available nahi hai, lekin main note kar leti hoon aur aapko callback ya SMS ke through confirm kar diya jayega.

APPRECIATION OR FEEDBACK HANDLING
Thank the caller warmly and log it. Example: Ye sunke bahut accha laga! Main ye feedback zaroor concerned team tak pohchaungi. Aapka time dene ke liye dhanyavaad.

COMMON COMPLAINT CATEGORIES TO RECOGNIZE
Train delay or frequency issue, overcrowding, AC not working in coach, escalator or lift out of order, cleanliness of station train or toilet, smart card recharge failure or balance not updated, ticket vending machine malfunction, staff misbehavior or rudeness, security or safety concern including harassment suspicious object or CCTV not working, lost and found item left on train or station, parking issue at station, announcement or signage issue, accessibility issue for elderly or disabled passengers, app website or QR ticket issue.

COMMON ENQUIRY CATEGORIES TO RECOGNIZE
First or last train timing, fare between two stations, route or interchange information, smart card recharge process or offers, parking availability and charges, nearest station to a landmark, lost item recovery process, senior citizen or student concession.

CLOSING
Always end calls this way. Kuch aur madad chahiye aapko? If no, then: Dhanyavaad [Name] ji, [METRO NAME] Metro Customer Care par call karne ke liye. Aapka din shubh ho!
English version: Is there anything else I can help you with? Thank you for calling [METRO NAME] Metro Customer Care. Have a great day!

HARD RULES, DO NOT BREAK
Never discuss topics unrelated to metro services. Never make up fare or schedule data, if unsure say so and offer a follow up. Never sound scripted or repetitive, vary phrasing every turn. Always collect name, number, and issue before ending any complaint call. Always mention SMS and email confirmation for complaints. Always remain respectful, even under provocation. Keep responses short since this is voice, not text. If it is a safety critical issue such as fire, medical emergency, or security threat, immediately prioritize and advise contacting on ground station staff or the emergency number [XXX], in addition to logging it.

PLACEHOLDERS TO FILL BEFORE DEPLOYMENT
[METRO NAME] is the metro brand, for example Delhi Metro, Pune Metro, or Namma Metro.
[X] is the resolution SLA in business days.
[XXX] is the emergency contact number.""",
)

pya = pyaudio.PyAudio()


class AudioLoop:
    def __init__(self):
        self.image_path = None
        self.audio_in_queue = None
        self.out_queue = None
        self.session = None
        self.audio_stream = None

    async def send_image_and_text(self, image_path, text="explain"):
        img = await asyncio.to_thread(self._get_image, image_path)
        if img is not None:
            if not isinstance(img, PIL.Image.Image):
                return
            image_io = io.BytesIO()
            img.save(image_io, format="JPEG")
            image_bytes = image_io.getvalue()
            prompt = text or "explain what is in this image"
            await self.session.send_realtime_input(
                video=types.Blob(data=image_bytes, mime_type="image/jpeg")
            )
            await self.session.send_realtime_input(text=prompt)
            return
        else:
            print("Image not found or could not be loaded!")

    async def send_text(self):
        while True:
            text = await asyncio.to_thread(input, "message > ")
            if text.lower() == "q":
                break
            elif text.startswith("image:"):
                image_path = text[6:].strip()
                if os.path.exists(image_path):
                    await self.send_image_and_text(image_path, "")
                else:
                    print(f"Sending text not image: {text}")
            else:
                await self.session.send_realtime_input(text=text)

    def _get_image(self, image_path):
        try:
            img = PIL.Image.open(image_path)
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail([1024, 1024])
            return img
        except FileNotFoundError:
            print(f"Error: Image file '{image_path}' not found.")
            return None
        except Exception as e:
            print(f"Error loading image '{image_path}': {e}")
            return None

    async def listen_audio(self):
        """Capture mic audio and queue it for Gemini (16 kHz PCM)."""
        mic_info = pya.get_default_input_device_info()
        self.audio_stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            input_device_index=mic_info["index"],
            frames_per_buffer=CHUNK_SIZE,
        )
        print(f"Mic on: {mic_info.get('name')} — speak freely (use headphones to avoid echo)")
        kwargs = {"exception_on_overflow": False}
        while True:
            data = await asyncio.to_thread(self.audio_stream.read, CHUNK_SIZE, **kwargs)
            await self.out_queue.put({"data": data, "mime_type": "audio/pcm;rate=16000"})

    async def send_realtime(self):
        while True:
            msg = await self.out_queue.get()
            try:
                if isinstance(msg, dict) and msg.get("mime_type", "").startswith("audio/pcm"):
                    await self.session.send_realtime_input(
                        audio=types.Blob(data=msg["data"], mime_type=msg["mime_type"])
                    )
            except Exception as e:
                print(f"Error in send_realtime: {e}")

    async def receive_audio(self):
        while True:
            turn = self.session.receive()
            async for response in turn:
                sc = getattr(response, "server_content", None)
                if sc is None:
                    continue
                if sc.interrupted:
                    while not self.audio_in_queue.empty():
                        self.audio_in_queue.get_nowait()
                    print("\n[interrupted]", flush=True)
                    continue
                if getattr(sc, "input_transcription", None) and sc.input_transcription.text:
                    print(f"\nYou: {sc.input_transcription.text}", flush=True)
                if getattr(sc, "output_transcription", None) and sc.output_transcription.text:
                    print(sc.output_transcription.text, end="", flush=True)
                if sc.model_turn is not None:
                    for part in sc.model_turn.parts:
                        if part.inline_data and part.inline_data.mime_type.startswith("audio/pcm"):
                            self.audio_in_queue.put_nowait(part.inline_data.data)
                        elif part.text:
                            print(part.text, end="", flush=True)

    async def play_audio(self):
        stream = await asyncio.to_thread(
            pya.open,
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
        )
        while True:
            bytestream = await self.audio_in_queue.get()
            await asyncio.to_thread(stream.write, bytestream)

    async def run(self):
        try:
            async with (
                client.aio.live.connect(model=MODEL, config=CONFIG) as session,
                asyncio.TaskGroup() as tg,
            ):
                self.session = session
                self.audio_in_queue = asyncio.Queue()
                self.out_queue = asyncio.Queue(maxsize=5)

                send_text_task = tg.create_task(self.send_text())
                tg.create_task(self.listen_audio())
                tg.create_task(self.send_realtime())
                tg.create_task(self.receive_audio())
                tg.create_task(self.play_audio())

                await send_text_task
                raise asyncio.CancelledError("User requested exit")
        except asyncio.CancelledError:
            pass
        except ExceptionGroup as EG:
            traceback.print_exception(EG)
        finally:
            if self.audio_stream:
                self.audio_stream.close()


if __name__ == "__main__":
    main = AudioLoop()
    asyncio.run(main.run())
