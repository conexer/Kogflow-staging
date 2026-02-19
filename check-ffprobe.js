const ffprobe = require('@ffprobe-installer/ffprobe');
const fs = require('fs');
console.log('ffprobe path:', ffprobe.path);
console.log('exists:', fs.existsSync(ffprobe.path));
