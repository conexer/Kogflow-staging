const fs = require('fs');
const path = require('path');

function getEnv(key) {
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
    return process.env[key];
}

const apiKey = getEnv('RUNNINGHUB_API_KEY');
const ecoId = '1962384725164433410';
const publicImageUrl = "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2000&auto=format&fit=crop";

async function test() {
    console.log(`🧪 Testing Eco Workflow ${ecoId} with public image...`);

    const payload = {
        nodeInfoList: [
            {
                nodeId: "39",
                fieldName: "image",
                fieldValue: publicImageUrl,
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
        const response = await fetch(`https://www.runninghub.ai/openapi/v2/run/ai-app/${ecoId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const json = await response.json();
        console.log('Result:', JSON.stringify(json, null, 2));

        if (json.taskId) {
            console.log(`\n🚀 Task created! ID: ${json.taskId}`);
            console.log(`⏳ Please wait ~30s then run: node check-hint.js (update taskId in script)`);

            // Auto-update check-eco-status.js
            const checkContent = fs.readFileSync('check-hint.js', 'utf8')
                .replace(/'2023674347629191169'|'2022237315807711233'/, `'${json.taskId}'`);
            fs.writeFileSync('check-eco-status.js', checkContent);
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
