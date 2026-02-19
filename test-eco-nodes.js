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
const testImageUrl = "https://vmuvjfflszhifuyvmjwh.supabase.co/storage/v1/object/public/uploads/1739784343118_v009h.jpg";

const PATTERNS = [
    { name: "Node 39 only", nodes: [{ nodeId: "39", fieldName: "image", fieldValue: testImageUrl }] },
    { name: "Node 39/44", nodes: [{ nodeId: "39", fieldName: "image", fieldValue: testImageUrl }, { nodeId: "44", fieldName: "string", fieldValue: "gliding in" }] },
    { name: "Node 39/44/45", nodes: [{ nodeId: "39", fieldName: "image", fieldValue: testImageUrl }, { nodeId: "44", fieldName: "string", fieldValue: "gliding in" }, { nodeId: "45", fieldName: "string", fieldValue: "5" }] },
    { name: "Node 12 only", nodes: [{ nodeId: "12", fieldName: "image", fieldValue: testImageUrl }] },
    { name: "Node 12/13", nodes: [{ nodeId: "12", fieldName: "image", fieldValue: testImageUrl }, { nodeId: "13", fieldName: "string", fieldValue: "gliding in" }] },
    { name: "Node 1/2", nodes: [{ nodeId: "1", fieldName: "image", fieldValue: testImageUrl }, { nodeId: "2", fieldName: "string", fieldValue: "gliding in" }] },
];

async function testPattern(pattern) {
    console.log(`\n🧪 Testing pattern: ${pattern.name}`);
    try {
        const response = await fetch(`https://www.runninghub.ai/openapi/v2/run/ai-app/${ecoId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nodeInfoList: pattern.nodes
            })
        });
        const json = await response.json();
        console.log('  Response:', JSON.stringify(json, null, 2));
        if (json.taskId) return json.taskId;
    } catch (e) {
        console.error(`  ❌ Failed: ${e.message}`);
    }
}

async function run() {
    for (const p of PATTERNS) {
        const taskId = await testPattern(p);
        if (taskId) {
            console.log(`\n🎉 FOUND IT! Pattern "${p.name}" works for 480p "Eco" workflow.`);
            break;
        }
    }
}

run();
