import type { WebSocketEvents } from 'vitest';

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
  private pc: RTCPeerConnection | undefined;
  public onAG2SocketClose: (ev: CloseEvent) => void;

  constructor(ag2SocketUrl: string, microphone?: MediaStreamTrack) {
    this.ag2SocketUrl = ag2SocketUrl;
    this.microphone = microphone;
    this.ws = null;
    this.onAG2SocketClose = (ev: CloseEvent) => {
      console.log('AG2 Websocket closed');
    };
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
    }
    if (this.pc) {
      this.pc.close();
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

      // Set up data channel for sending and receiving events
      const _dc = pc.createDataChannel('oai-events');
      _dc.addEventListener('message', (e) => {
        // Realtime server events appear here!
        try {
          const message: AG2Message = JSON.parse(e.data);
          if (message.type && message.type.includes('function')) {
            console.log('WebRTC function message', message);
            ws.send(e.data);
          }
        } catch (error) {
          console.error('Error parsing message', e.data, error);
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
      this.onAG2SocketClose(event);
    };

    this.ws.onmessage = async (event) => {
      try {
        const message: AG2Message = JSON.parse(event.data);
        console.info('Received Message from AG2 backend', message);
        const type = message.type;
        if (type === 'ag2.init') {
          await openRTC(
            message as AG2InitMessage,
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
