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
const taskId = '2023967691353755650';

async function check() {
    console.log(`🧪 Checking successful task ${taskId}...`);
    try {
        const response = await fetch('https://www.runninghub.cn/openapi/v2/query', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                taskId: taskId
            })
        });
        const json = await response.json();
        console.log('Status Result:', JSON.stringify(json, null, 2));
    } catch (error) {
        console.log('Error:', error.message);
    }
}

check();
