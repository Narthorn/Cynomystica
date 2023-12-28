import { user, type userType } from './user';
import { userSettings } from './userSettings';
import { video } from './video';
import type { videoType } from './video';
import { playlist } from './playlist';
import { chat } from './chat';
import { io } from '$lib/realtime';
import { users, type otherUser } from './users';
import { blocker } from './blocker';
import { schedule } from './schedule';
import type { iconList } from './icons';
import { icons } from './icons';
import { login } from '$lib/utilities/login';
import { permissions } from './permissions';
import { tabText } from './tabText';
import { theThreeGuys } from '$lib/special/theThreeGuys/parseThreeGuys';
import { emotes, type Emote } from './emotes';
import { polls, type Poll } from './polls';
import { tempSettings } from './tempSettings';
import { presets } from './presets';
import { settings } from './settings';

let userObj: userType;
let emoteObj: Record<string, Emote> = {};
let tempSettingObj: Record<string, any> = {};
let userSettingsObj: Record<string, any> = {};
let presetObj: Record<string, Record<string, boolean>> = {};
let settingsObj: Record<string, string> = {};
let initPreset = true;
user.subscribe((e) => {
	userObj = e;
});
emotes.subscribe((e) => {
	emoteObj = e;
});
tempSettings.subscribe((e) => {
	tempSettingObj = e;
});
userSettings.subscribe((e) => {
	userSettingsObj = e;
});
presets.subscribe((e) => {
	presetObj = e;
	if (!initPreset) {
		io.emit('upsert-presets', e);
	}
});
settings.subscribe((e) => {
	settingsObj = e;
});

const init = () => {
	io.on('connected', (e) => {
		io.emit('version', 1.05);
		user.update((n) => {
			n.uuid = e;
			return n;
		});
		if (localStorage.getItem('username')) {
			login(localStorage.getItem('username'), localStorage.getItem('refreshToken'), 'token');
		} else {
			let reload = false;
			if (userObj.username?.length > 0) reload = true;
			user.set({
				username: '',
				accessLevel: -1,
				icon: '',
				accessToken: undefined,
				refreshToken: undefined,
				uuid: e
			});
			if (reload) location.reload();
		}
	});
	io.on('poll', (e: Record<string, Poll>) => {
		polls.update((n) => {
			for (const pollID in n) {
				const nPoll = n[pollID];
				if (nPoll.dateClose !== undefined && e[pollID] !== undefined) {
					e[pollID] = nPoll;
				}
			}
			return e;
		});
	});

	io.on('presets', (e: Record<string, Record<string, boolean>>) => {
		initPreset = true;
		presets.set(e);
		initPreset = false;
	});

	let currentChat: Array<object>;
	chat.subscribe((value) => {
		currentChat = value;
	});
	let currentVideo: videoType;
	video.subscribe((value) => {
		currentVideo = value;
	});
	io.emit('get-playlist');
	io.on('playlist', (e) => {
		if (e.status == 'success') {
			playlist.set(e.playlist);
			if (!e.playlist.length) {
				video.set({ id: '', url: '', seekTime: 0, type: '' });
			} else {
				if (e.playlist[e.playlistIndex].id !== currentVideo.id) {
					video.set(e.playlist[e.playlistIndex]);
				}
			}
			theThreeGuys.set(e.theThreeGuys);
		}
	});
	const chatSFX = [
		[`<span class='redtext'>`, '/redtruth.mp3'],
		['ahaha.wav', '/ahaha.wav.mp3']
	];
	io.on('message', (e) => {
		chat.update((oldChat) => {
			const pushMsg = (msg) => {
				if (msg.message) {
					for (const emote of Object.values(emoteObj).filter(
						(e) => presetObj.emotes[e.preset] == true
					)) {
						msg.message = msg.message.replaceAll(
							emote.text,
							`<img title='${emote.text}' class='emote' src='${emote.url}'/>`
						);
					}
					if (tempSettingObj.audio == true) {
						for (const sfx of chatSFX) {
							if (msg.message.includes(sfx[0])) {
								const audioElement = document.createElement('audio');
								audioElement.autoplay = true;
								audioElement.src = sfx[1];
								const app = document.getElementById('app');
								app?.append(audioElement);
								setTimeout(() => {
									app?.removeChild(audioElement);
								}, 5000);
							}
						}
					}
					if (tempSettingObj.hideImage) {
						msg.message = msg.message.replace(/<img[^>]*>/g, '');
					}
					msg.played = false;
					oldChat.push(msg);
					if (oldChat.length > userSettingsObj.chat.chatArray)
						oldChat.splice(0, oldChat.length - userSettingsObj.chat.chatArray);
				}
			};
			if (e?.length > 0) {
				for (const msg of e) {
					pushMsg(msg);
				}
			} else {
				if (e.message?.includes(userObj.username) && userObj.username) {
					if (document.hidden == true) tabText.set(`*Pinged by ${e.username}*`);
				}
				pushMsg(e);
			}

			return oldChat;
		});
	});
	io.on('messages', (e) => {
		chat.set(e);
	});
	io.on('seek-update', (e) => {
		if (e.status == 'success') {
			video.update((v) => {
				v.seekTime = e.seekTime;
				return v;
			});
		}
	});
	io.on('connected-users', (e) => {
		users.update((n) => {
			const usersArr: Array<otherUser> = Object.values(e);
			usersArr.sort((a, b) => {
				if (a.accessLevel < b.accessLevel) return 1;
				if (a.accessLevel > b.accessLevel) return -1;
				if (a.username > b.username) return 1;
				if (a.username < b.username) return -1;
				return 0;
			});
			n.connectedUsers = Object.values(e).length;
			n.users = usersArr;
			return n;
		});
	});
	io.on('icons', (e: iconList) => {
		icons.set(e);
	});
	io.on('access-update', (e) => {
		user.update((n) => {
			n.accessLevel = e;
			return n;
		});
	});
	io.on('login', (e) => {
		blocker.update((n) => {
			n.login = false;
			return n;
		});
		user.update((n) => {
			return {
				username: e.username,
				accessLevel: e.accessLevel,
				icon: '',
				accessToken: e.accessToken,
				refreshToken: e.refreshToken,
				uuid: n.uuid
			};
		});
		if (e.accessLevel >= 1) {
			localStorage.setItem('accessToken', e.accessToken.token);
			localStorage.setItem('accessTokenExpires', e.accessToken.expires);
			localStorage.setItem('refreshToken', e.refreshToken.token);
			localStorage.setItem('refreshTokenExpires', e.refreshToken.expires);
			localStorage.setItem('username', e.username);
		}
		if (settingsObj.joinMessage)
			io.emit('message', { icon: userSettingsObj.icon, msg: settingsObj.joinMessage });
	});
	io.on('schedule', (e) => {
		if (e.status == 'success') {
			schedule.set(e.schedule);
		}
	});
	io.on('permissions', (e) => {
		permissions.update((n) => {
			Object.assign(n, e);
			return n;
		});
	});
	io.on('usersettings', (e) => {
		if (e) {
			e.blockSave = true;
			userSettings.set(e);
			setTimeout(() => {
				e.blockSave = false;
				userSettings.set(e);
			}, 500);
		}
	});
	io.on('emotes', (e) => {
		emotes.set(e);
	});
	io.on('settings', (e) => {
		settings.update((n) => {
			for (const prop in n) {
				if (e[prop] !== undefined) n[prop] = e[prop];
			}
			return n;
		});
	});
};
export default init;
