const fluentFfmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');

const ffprobePath = require('@ffprobe-installer/ffprobe');
// Configure ffmpeg and ffprobe paths
fluentFfmpeg.setFfmpegPath(ffmpegPath.path);
fluentFfmpeg.setFfprobePath(ffprobePath.path);

function getEnv(key) {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.startsWith(key + '=')) {
                    return line.substring(key.length + 1).replace(/"/g, '').trim();
                }
            }
        }
    } catch (e) { }
    return process.env[key];
}

const apiKey = getEnv('RUNNINGHUB_API_KEY');

async function runTest() {
    console.log('🧪 Standalone FFmpeg Test');
    console.log('Using FFmpeg at:', ffmpegPath.path);

    const tempDir = path.join(process.cwd(), 'tmp_test');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const videoUrls = [
        "https://www.runninghub.ai/openapi/output/2026-02-17/2023654478565216258/0.mp4",
        "https://www.runninghub.ai/openapi/output/2026-02-17/2023654488639938562/0.mp4"
    ];

    const inputFiles = [];
    try {
        console.log('⬇️ Downloading clips...');
        for (let i = 0; i < videoUrls.length; i++) {
            const localPath = path.join(tempDir, `test_clip_${i}.mp4`);
            const response = await fetch(videoUrls[i], {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            const buffer = await response.arrayBuffer();
            fs.writeFileSync(localPath, Buffer.from(buffer));
            inputFiles.push(localPath);
            console.log(`✅ Saved clip ${i}`);
        }

        const outputPath = path.join(tempDir, `test_final.mp4`);
        console.log('🎞️ Stitching...');

        const command = fluentFfmpeg();
        inputFiles.forEach(file => command.input(file));

        await new Promise((resolve, reject) => {
            command
                .on('start', (cmdLine) => console.log('Spawned Ffmpeg with command: ' + cmdLine))
                .on('error', (err) => {
                    console.error('FFmpeg Error:', err);
                    reject(err);
                })
                .on('end', () => {
                    console.log('✅ Stitching complete!');
                    resolve(true);
                })
                .mergeToFile(outputPath, tempDir);
        });

        console.log('🎉 Test Success! Output at:', outputPath);

    } catch (e) {
        console.error('❌ Test Failed:', e);
    } finally {
        // We'll keep the files for inspection if it failed, otherwise cleanup
        // inputFiles.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
    }
}

runTest();
