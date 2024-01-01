import ioClient from 'socket.io-client';
import CONFIG from './clientconfig.json';
const endPoint = CONFIG.SOCKET_URL.match(/^.+\/\/.+\//g)?.[0] ?? '';
const path = CONFIG.SOCKET_URL.substring(endPoint.length);
const socket = ioClient(endPoint, {
	path: `/${path}`,
	transports: ['websocket'],
	upgrade: false
});
export const io = socket;
