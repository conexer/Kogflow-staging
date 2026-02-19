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
const stableId = '1961996521397010434';

async function test() {
    console.log(`🧪 Triggering fresh task on: ${stableId}`);
    const payload = {
        nodeInfoList: [
            {
                nodeId: "39",
                fieldName: "image",
                fieldValue: "https://vmuvjfflszhifuyvmjwh.supabase.co/storage/v1/object/public/uploads/project-assets/0c57e2d1-11d3-4fb8-9a92-815338ecd90f/1769729985032_knxc9w.png",
                description: "Image"
            },
            {
                nodeId: "44",
                fieldName: "string",
                fieldValue: "the camera very slowly glides into the scene",
                description: "Prompt"
            },
            {
                nodeId: "45",
                fieldName: "string",
                fieldValue: "5",
                description: "Duration"
            },
            {
                nodeId: "91",
                fieldName: "string",
                fieldValue: "30 fps, low quality, 480p",
                description: "Special"
            }
        ]
    };

    try {
        const response = await fetch(`https://www.runninghub.ai/openapi/v2/run/ai-app/${stableId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const json = await response.json();
        console.log('Result:', JSON.stringify(json, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }
}

test();
