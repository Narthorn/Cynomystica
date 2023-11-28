import { Server } from "socket.io";
import { socketInterface, default as IO } from "./socket";
import parseURL, { parseRaw } from "../lib/parseURL";
import { cycle } from "./cycle";
import schedule from "../sqliteTables/schedule";
import moment from "moment";
import playlists from "../sqliteTables/playlists";

export type PlaylistOrder = Array<number>;
export type PlaylistObj = Array<PlaylistItem>;
export interface PlaylistItem {
  id: number;
  name: string;
  url: string;
  startDate: Date | null;
  endDate: Date | null;
  username: string;
  duration: number;
  type: string;
  scheduledID: number | null;
}

class PlayList {
  playlist: PlaylistObj;
  currentSeekTime: number;
  playing: boolean;
  constructor() {
    this.playlist = [];
    this.currentSeekTime = 0;
    this.playing = false;
    console.log("Playlist Initialized");
  }
  send(socket: Server | socketInterface | null) {
    if (socket == null) socket = IO();
    /*const clientPlaylist: Array<object> = [];
    for (const id in this.order) {
      clientPlaylist[id] = this.playlist[this.order[id]];
    }*/
    console.log("playlist.send");
    socket.emit("playlist", {
      status: "success",
      playlist: this.playlist,
      playlistIndex: 0,
      seektime: this.currentSeekTime,
    });
  }
  updateDates() {
    if (!this.playlist.length) {
      this.currentSeekTime = 0;
      this.playing = false;
      return;
    }
    let change = false;
    if (this.playing) {
      this.currentSeekTime =
        Math.abs(new Date().getTime() - this.playlist[0].startDate.getTime()) /
        1000;
      if (this.currentSeekTime > this.playlist[0].duration) {
        this.deleteVideo(this.playlist[0].id);
        this.playing = false;
        change = true;
      }
    }
    if (!this.playing && this.playlist.length) {
      this.playing = true;
      this.currentSeekTime = 0;
      this.playlist[0].startDate = new Date();
      change = true;
    }
    let lastEndDate = null;
    for (let index in this.playlist) {
      let item = this.playlist[index];
      // @ts-ignore
      if (index > 0) {
        item.startDate = lastEndDate;
      }
      if (!(item.duration > 0)) break;
      item.endDate = new Date(item.startDate.getTime() + item.duration * 1000);
      lastEndDate = item.endDate;
    }
    if (change) playlist.send(IO());
    IO().emit("seek-update", {
      status: "success",
      seekTime: this.currentSeekTime,
    });
  }
  queueVideo = async (
    mediaURL: string,
    username: string,
    socket: socketInterface
  ) => {
    const id: number = Math.random();
    console.log(mediaURL);
    const socketError = (message: string) => {
      if (socket) {
        socket.emit("alert", {
          type: "queue",
          message,
        });
      }
    };
    if (mediaURL.includes(" ")) {
      socketError("Invalid link");
      return;
    }
    if (!mediaURL) {
      socketError("Empty link");
      return;
    }
    if (socket) {
      if (parseRaw(new URL(mediaURL)).type == "raw" && socket.accessLevel < 2) {
        socketError(`You don't have permission to queue raw videos`);
        return;
      }
    }
    await parseURL(mediaURL)
      .then((playlistItem) => {
        playlistItem.id = id;
        playlistItem.username = username;
        let currentLen = 0;
        if (socket) {
          if (socket.accessLevel < 2) {
            for (let i of this.playlist) {
              if (i.username == username) currentLen += i.duration;
            }
            currentLen += playlistItem.duration;
            if (currentLen > 900) {
              socketError(`Can not have more than 15 min queued`);
              return;
            }
          }
        }

        if (this.playlist.length) {
          let lastItem = this.playlist[this.playlist.length - 1];
          playlistItem.startDate = lastItem.endDate;
          playlistItem.endDate = new Date(
            playlistItem.startDate.getTime() + playlistItem.duration * 1000
          );
        } else {
          playlistItem.startDate = new Date();
          playlistItem.endDate = new Date(
            Date.now() + playlistItem.duration * 1000
          );
        }
        this.playlist.push(playlistItem);
      })
      .catch(() => {
        socketError(`Video type not supported`);
      });
  };
  deleteVideo(id: number) {
    for (let index in this.playlist) {
      if (this.playlist[index].id == id)
        this.playlist.splice(parseInt(index), 1);
    }
    cycle();
  }
  checkSchedule = async () => {
    let scheduled = await schedule.getAll(new Date(Date.now() - 60000));
    let nextScheduled = scheduled[0];
    if (nextScheduled) {
      let tempPlaylist = [];
      for (let item of scheduled) {
        if (this.playlist.length == 0) {
          if (moment.utc(item.playTimeUTC).diff(moment()) / 1000 <= 5) {
            await this.queueVideo(item.url, item.username, null);
          } else {
            break;
          }
        } else {
          let lastItem = this.playlist[this.playlist.length - 1];
          let diff =
            moment.utc(item.playTimeUTC).diff(moment(lastItem.endDate)) / 1000;
          if (diff <= 300 && diff > 0) {
            await this.queuePlaylist({
              mode: "weighted",
              playlist: "Commercials",
              duration: diff,
              leeWayAfter: item.leeWayAfter,
            });
            await this.queueVideo(item.url, item.username, null);
          } else {
            if (
              moment.utc(item.playTimeUTC).diff(moment()) / 1000 <= 0 &&
              this.playlist[0].url != item.url
            ) {
              tempPlaylist = structuredClone(this.playlist);
              this.playlist = [];
              await this.queueVideo(item.url, item.username, null);
            } else {
              break;
            }
          }
        }
      }
      this.playlist = this.playlist.concat(tempPlaylist);
    }
  };
  queuePlaylist = async (options: any) => {
    let items = await playlists.getPlaylist(options.playlist);
    let maxTries = 1000;
    let tries = 0;
    let complete = false;
    let minDuration = options.duration;
    let maxDuration = options.duration;
    if (options.leeWayAfter) {
      maxDuration += options.leeWayAfter;
    }
    do {
      let duration = 0;
      let queue = [];
      complete = false;
      loop: for (let item of items) {
        duration += item.duration;
        queue.push(item);
        if (duration >= minDuration && duration <= maxDuration) {
          complete = true;
          for (let subitem of queue) {
            await this.queueVideo(subitem.url, subitem.username, null);
            await playlists.updatePlayCount(subitem.id);
          }
          break loop;
        } else if (duration > maxDuration) {
          break;
        }
      }
      tries++;
      shuffleArray(items);
    } while (tries < maxTries && !complete);
    function shuffleArray(array: any) {
      for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
      }
    }
  };
}

let playlist = new PlayList();
export default playlist;
