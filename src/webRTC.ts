import { ResamplerProcessorSrc } from './soundWorklet';

interface AG2InitMessage {
  type: 'ag2.init';
  config: {
    client_secret: { value: string };
    model: string;
  };
  init: any[]; // Define the actual type if possible, use any[] if unknown
}

interface AG2Message {
  type: string;
  [key: string]: any; // Allows any other properties
}

export class WebRTC {
  private ag2SocketUrl: string;
  private microphone?: MediaStreamTrack;
  private ws: WebSocket | null;
  private pc: RTCPeerConnection | null;
  public onDisconnect: () => void;

  constructor(ag2SocketUrl: string, microphone?: MediaStreamTrack) {
    this.ag2SocketUrl = ag2SocketUrl;
    this.microphone = microphone;
    this.ws = null;
    this.pc = null;
    this.onDisconnect = () => {
      console.log('WebRTC disconnected');
    };
  }

  async close(): Promise<void> {
    if (this.microphone) {
      this.microphone?.stop();
      this.microphone = undefined;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.close();
    }
    if (this.pc) {
      const pc = this.pc;
      this.pc = null;
      pc.close();
    }
  }

  async connect(): Promise<void> {
    let dc: RTCDataChannel | null = null; // data connection
    const quedMessages: string[] = []; // queue messages from the server before the data connection is open
    let resolve: () => void, reject: (reason?: any) => void;
    let completed = new Promise<void>((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });

    this.pc = new RTCPeerConnection();

    async function openRTC(
      init_message: AG2InitMessage,
      webRTC: WebRTC,
      pc: RTCPeerConnection,
      ws: WebSocket,
      mic: MediaStreamTrack,
      resolve: () => void,
      reject: (reason?: any) => void,
    ): Promise<void> {
      const data = init_message.config;
      const EPHEMERAL_KEY = data.client_secret.value;

      // Set up to play remote audio from the model
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      pc.ontrack = (e) => {
        const audioTrack = e.streams[0];
        if (audioTrack) {
          audioEl.srcObject = audioTrack;
        }
      };
      // Add local audio track for microphone input in the browser
      mic.enabled = false;
      pc.addTrack(mic);

      pc.onconnectionstatechange = (e) => {
        if (pc.connectionState === 'disconnected') {
          webRTC.close();
          webRTC.onDisconnect();
        }
      };
      // Set up data channel for sending and receiving events
      const _dc = pc.createDataChannel('oai-events');

      _dc.addEventListener('message', (e) => {
        // Realtime server events appear here!
        let message: AG2Message;
        try {
          message = JSON.parse(e.data);
        } catch (error) {
          console.error('Error parsing message', e.data, error);
          return;
        }
        if (message.type && message.type.includes('function')) {
          console.log('WebRTC function message', message);
          try {
            ws.send(e.data);
          } catch (error) {
            console.error(
              'Error sending function message to AG2 backend',
              error,
            );
            webRTC.close();
          }
        }
      });

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = data.model;
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          'Content-Type': 'application/sdp',
        },
      });

      const answer: RTCSessionDescriptionInit = {
        type: 'answer',
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);
      console.log('Connected to OpenAI WebRTC');
      _dc.onopen = (e) => {
        console.log('Data connection opened.');
        for (const init_chunk of init_message.init) {
          _dc.send(JSON.stringify(init_chunk));
        }
        console.log('Sent init chunks to OpenAI WebRTC');
        for (const qmsg of quedMessages) {
          _dc.send(qmsg);
        }
        console.log('Sent queued messages to OpenAI WebRTC');
        mic.enabled = true;
        dc = _dc;
        resolve();
      };
    }

    if (!this.microphone) {
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const audioContext = new window.AudioContext();

      // 2. Create a MediaStreamSource
      const source = audioContext.createMediaStreamSource(ms);

      // 3. Get the sampling rate from the AudioContext
      const sampleRate = audioContext.sampleRate;

      console.log('Sampling Rate:', sampleRate);
      console.log('ResamplerSrc', ResamplerProcessorSrc);
      await audioContext.audioWorklet.addModule(ResamplerProcessorSrc);
      const resamplerNode = new AudioWorkletNode(
        audioContext,
        'resampler-processor',
        {
          processorOptions: {
            outputSampleRate: 24000,
          },
        },
      );
      source.connect(resamplerNode).connect(audioContext.destination);
      resamplerNode.port.onmessage = (event) => {
        console.log('Received message from resampler node', event);
        if (event.data.type === 'resampledData') {
          const resampledData = event.data.data; //Get resampledData
          // Now you have access to the resampled data in your main thread.
          // You can do whatever you need with it (e.g., visualize it, record it, etc.).
          console.log('Received resampled data:', resampledData);
        }
      };

      const microphone = ms.getTracks()[0];
      if (!microphone) {
        throw new Error('No microphone found');
      }
      this.microphone = microphone;
      microphone.enabled = false;
    }

    this.ws = new WebSocket(this.ag2SocketUrl);

    this.ws.onopen = (event) => {
      console.log('web socket opened');
    };

    this.ws.onclose = (event) => {
      this.close();
      this.onDisconnect();
    };

    this.ws.onmessage = async (event) => {
      try {
        const message: AG2Message = JSON.parse(event.data);
        console.info('Received Message from AG2 backend', message);
        const type = message.type;
        if (type === 'ag2.init') {
          await openRTC(
            message as AG2InitMessage,
            this,
            this.pc as RTCPeerConnection,
            this.ws as WebSocket,
            this.microphone as MediaStreamTrack,
            resolve,
            reject,
          );
          return;
        }
        const messageJSON = JSON.stringify(message);
        if (dc) {
          dc.send(messageJSON);
        } else {
          console.log('DC not ready yet, queueing', message);
          quedMessages.push(messageJSON);
        }
      } catch (error) {
        console.error('Error processing websocket message', event.data, error);
      }
    };
    await completed;
    console.log('WebRTC fully operational');
  }
}
