import express from "express";
import config from "../config.json";
import { createServer } from "node:http";
import dbInit from "./init/dbInit";
import { v4 as uuidv4 } from "uuid";
import md5 from "md5";

import {
  socketInterface,
  init,
  default as IO,
  sendUserList,
} from "./server/socket";
import { default as chat } from "./server/chat";
import Icons from "./sqliteTables/icons";
import userModeration from "./sqliteTables/userModeration";

import message from "./controller/message";
import deleteItem from "./controller/delete-item";
import disconnect from "./controller/disconnect";
import getPlaylist from "./controller/get-playlist";
import loginGuest from "./controller/login-guest";
import queueNext from "./controller/queue-next";
import signIn from "./controller/sign-in";
import signUp from "./controller/sign-up";
import upsertSchedule from "./controller/upsert-schedule";
import loginToken from "./controller/login-token";
import getSchedule from "./controller/get-schedule";
import sendPermissions from "./lib/sendPermissions";
import userMod from "./controller/user-mod";
import version from "./controller/version";
import upsertUserSettings from "./controller/upsert-usersettings";
import closePoll from "./controller/polls/close-poll";
import createPoll from "./controller/polls/create-poll";
import deletePoll from "./controller/polls/delete-poll";
import votePoll from "./controller/polls/vote-poll";

import playlist from "./server/playlist";
import updatePlaylist from "./controller/update-playlist";
import SyncPlay from "./server/syncplay";
import sendEmotes from "./lib/sendEmotes";
import polls from "./server/polls";

dbInit();
const app = express();
const port = config.PORT;
const server = createServer(app);
// @ts-ignore
init(server);
let io = IO();
//let syncPlay = SyncPlay();
//playlist.queuePlaylist({ playlist: "Commercials", duration: 500 });

const ioEvents = {
  "delete-item": deleteItem,
  disconnect: disconnect,
  "get-playlist": getPlaylist,
  "login-guest": loginGuest,
  message: message,
  "queue-next": queueNext,
  "sign-in": signIn,
  "sign-up": signUp,
  "upsert-schedule": upsertSchedule,
  "login-token": loginToken,
  "get-schedule": getSchedule,
  "user-mod": userMod,
  version: version,
  "update-playlist": updatePlaylist,
  "upsert-usersettings": upsertUserSettings,
  "close-poll": closePoll,
  "create-poll": createPoll,
  "delete-poll": deletePoll,
  "vote-poll": votePoll,
};
io.on("connection", async (socket: socketInterface) => {
  socket.uuid = uuidv4();
  socket.handshake.headers["x-real-ip"] = md5(
    socket.handshake.headers["x-real-ip"] ?? ""
  );
  console.log("new connection", socket.handshake.headers["x-real-ip"]);
  if (!socket.request.headers["user-agent"]) socket.disconnect();
  console.log(64, await userModeration.getUser(socket.handshake["x-real-ip"]));
  if ((await userModeration.getUser(socket.handshake["x-real-ip"])).length) {
    socket.emit("alert", {
      type: "IP banned",
      message: "This IP has been banned",
    });
    socket.disconnect();
    return;
  }
  socket.emit("connected", socket.uuid);
  for (let event in ioEvents) {
    try {
      socket.on(event, async (msg) => {
        ioEvents[event](socket, msg);
      });
    } catch (err) {
      console.log(socket.username, new Date(), err);
    }
  }
  socket.on("connection", (socket2) => {
    console.log("reconnection", socket.username, socket2.username);
  });
  sendUserList();
  sendPermissions(socket);
  sendEmotes(socket);
  chat().getRecent(socket);
  polls().get(socket);
  socket.emit("icons", await Icons.get());
  getSchedule(socket);
});

server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

export default app;
