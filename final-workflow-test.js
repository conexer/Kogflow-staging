
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
const workflowId = '1961996521397010434';
const testImageUrl = "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?q=80&w=2000&auto=format&fit=crop";

async function testWorkflow() {
    console.log(`🧪 Testing Workflow: ${workflowId}...`);

    const payload = {
        nodeInfoList: [
            {
                nodeId: "39",
                fieldName: "image",
                fieldValue: testImageUrl,
                description: "Image"
            },
            {
                nodeId: "44",
                fieldName: "string",
                fieldValue: "the camera very slowly glides into the scene, 1280p high quality 30fps",
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
                fieldValue: "constant 30 fps, 1280p, high quality, smooth motion, aspect ratio: 16:9",
                description: "Special requirements"
            }
        ]
    };

    try {
        const response = await fetch(`https://www.runninghub.cn/openapi/v2/run/ai-app/${workflowId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const json = await response.json();
        console.log('API Response:', JSON.stringify(json, null, 2));

        if (json.taskId) {
            console.log(`\n🚀 Task created! ID: ${json.taskId}`);
            // Update check script
            const checkFile = path.resolve(process.cwd(), 'check-workflow-status.js');
            const checkCode = `
const apiKey = '${apiKey}';
const taskId = '${json.taskId}';

async function check() {
    console.log('🔍 Checking status for task ' + taskId + '...');
    const response = await fetch('https://www.runninghub.cn/openapi/v2/query/ai-app/${workflowId}', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ taskId })
    });
    const json = await response.json();
    console.log('Status Result:', JSON.stringify(json, null, 2));
}
check();
            `.trim();
            fs.writeFileSync(checkFile, checkCode);
            console.log(`⏳ Run 'node check-workflow-status.js' in a few seconds to check progress.`);
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

testWorkflow();
