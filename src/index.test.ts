import { WebRTC, WebsocketAudio } from './index';
import { test, expect } from 'vitest';

test('WebRTC can be constructed', () => {
  const webRTC = new WebRTC('ws://socket.ag2.ai');
});

test('WebSocektAudio can be constructed', () => {
  const webRTC = new WebRTC('ws://socket.ag2.ai');
});
