const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow frontend
    methods: ["GET", "POST"]
  }
});

const rooms = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("create-room", ({ name }, callback) => {
    const roomCode = Math.random().toString(36).substr(2, 5).toUpperCase();
    rooms[roomCode] = {
      host: socket.id,
      players: [{ id: socket.id, name, score: 0 }],
      started: false,
      currentQ: 0,
      questions: []
    };
    socket.join(roomCode);
    callback({ roomCode });
    io.to(roomCode).emit("players-update", rooms[roomCode].players);
  });

  socket.on("join-room", ({ roomCode, name }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ error: "Room not found" });
    if (room.players.length >= 8) return callback({ error: "Room is full" });

    room.players.push({ id: socket.id, name, score: 0 });
    socket.join(roomCode);
    callback({ success: true });
    io.to(roomCode).emit("players-update", room.players);
  });

  socket.on("start-game", async ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const response = await axios.get("https://opentdb.com/api.php?amount=5&type=multiple");
    room.questions = response.data.results;
    room.started = true;
    room.currentQ = 0;

    sendNextQuestion(roomCode);
  });

  socket.on("submit-answer", ({ roomCode, answer }) => {
    const room = rooms[roomCode];
    if (!room || !room.started) return;

    const currentQ = room.questions[room.currentQ];
    const player = room.players.find(p => p.id === socket.id);
    if (player && answer === currentQ.correct_answer) {
      player.score += 1;
    }

    if (!room.answers) room.answers = new Set();
    room.answers.add(socket.id);

    if (room.answers.size === room.players.length) {
      room.answers = new Set();
      room.currentQ += 1;
      if (room.currentQ < room.questions.length) {
        sendNextQuestion(roomCode);
      } else {
        io.to(roomCode).emit("game-over", room.players);
      }
    }
  });

  socket.on("disconnect", () => {
    for (let roomCode in rooms) {
      let room = rooms[roomCode];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) delete rooms[roomCode];
      else io.to(roomCode).emit("players-update", room.players);
    }
  });

  function sendNextQuestion(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const q = room.questions[room.currentQ];
    const choices = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
    io.to(roomCode).emit("question", {
      question: q.question,
      choices,
      qNum: room.currentQ + 1,
      total: room.questions.length
    });
  }
});

server.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});

