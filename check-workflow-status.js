
const apiKey = 'f33ddb9d5f1f48958df69577f6cdaa8d';
const taskId = '2024574012738375682';

async function check() {
    console.log('🔍 Checking status for task ' + taskId + '...');
    try {
        const response = await fetch('https://www.runninghub.cn/openapi/v2/query', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskId })
        });
        const json = await response.json();
        console.log('Status Result:', JSON.stringify(json, null, 2));
    } catch (e) {
        console.error('Error checking status:', e.message);
    }
}
check();