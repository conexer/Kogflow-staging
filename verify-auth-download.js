const fs = require('fs');
const path = require('path');

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
const videoUrl = "https://www.runninghub.ai/openapi/output/2026-02-17/2023654478565216258/0.mp4";

async function verifyDownload() {
    console.log('🧪 Verifying Query Param Auth...');
    const videoUrlCn = videoUrl.replace('.ai', '.cn');
    const variations = [
        `${videoUrl}?apiKey=${apiKey}`,
        `${videoUrl}?token=${apiKey}`,
        `${videoUrlCn}`,
        `${videoUrlCn}?apiKey=${apiKey}`,
        `${videoUrlCn}?token=${apiKey}`,
        `${videoUrlCn}?access_token=${apiKey}`
    ];

    for (const url of variations) {
        try {
            console.log(`Trying: ${url.split('?')[1]}`);
            const response = await fetch(url);
            const contentType = response.headers.get('content-type');
            const buffer = await response.arrayBuffer();
            const head = Buffer.from(buffer.slice(0, 100)).toString();

            if (buffer.byteLength > 100 && !head.includes('TOKEN_INVALID')) {
                console.log(`✅ SUCCESS with: ${url.split('?')[1]}!`);
                return;
            } else {
                console.log(`❌ Failed: ${head.substring(0, 30)}...`);
            }
        } catch (e) {
            console.log(`Error: ${e.message}`);
        }
    }
}

verifyDownload();
