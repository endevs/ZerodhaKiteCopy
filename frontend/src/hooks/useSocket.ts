import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_BASE_URL } from '../config/api';

let sharedSocket: Socket | null = null;
let refCount = 0;

function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_BASE_URL, {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      forceNew: false,
      autoConnect: true,
      withCredentials: true,
    });
  }
  return sharedSocket;
}

export function useSocket(): Socket {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = getSharedSocket();
    socketRef.current = socket;
    refCount++;

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      refCount--;
      if (refCount <= 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        refCount = 0;
      }
    };
  }, []);

  return socketRef.current ?? getSharedSocket();
}
