const fs = require('fs');
const path = require('path');

async function testStitch() {
    console.log('🧪 Testing Video Stitching API...');

    // Using verified URLs from previous successful generations
    const testData = {
        videoUrls: [
            "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/b564f76fefd5acfc5b04f28e06fbeb5a/output/fire-AI高清版_00001_p86_ybrpp_1771316824.mp4",
            "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/b564f76fefd5acfc5b04f28e06fbeb5a/output/fire-AI去AI味_00001_p86_avvnf_1771316840.mp4"
        ],
        title: "Test Linear Motion",
        subtitle: "Verification Run",
        userId: "test-user-123",
        projectId: "test-project-456"
    };

    try {
        const response = await fetch('http://localhost:3000/api/stitch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });

        const result = await response.json();
        console.log('Result:', JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('✅ Stitching Success!');
            console.log('🔗 Final Video:', result.videoUrl);
        } else {
            console.error('❌ Stitching Failed:', result.error);
        }
    } catch (error) {
        console.error('Error connecting to API:', error.message);
        console.log('Make sure the dev server is running on http://localhost:3000');
    }
}

testStitch();
