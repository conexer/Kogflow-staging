const ffmpegPath = require('@ffmpeg-installer/ffmpeg');
console.log('FFmpeg Path:', ffmpegPath.path);
const fs = require('fs');
console.log('Path exists:', fs.existsSync(ffmpegPath.path));
