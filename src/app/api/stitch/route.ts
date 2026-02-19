import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
    console.log('🚀 Stitch POST request received (Direct FFmpeg Version)');

    try {
        const { videoUrls, title, subtitle, userId, projectId } = await req.json();
        if (!videoUrls || videoUrls.length === 0) {
            return NextResponse.json({ error: 'No video URLs provided' }, { status: 400 });
        }

        const tempDir = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const runId = uuidv4();
        const inputFiles: string[] = [];

        // 1. Download clips
        console.log('⬇️ Downloading clips...');
        for (let i = 0; i < videoUrls.length; i++) {
            const localPath = path.join(tempDir, `${runId}_clip_${i}.mp4`);
            const response = await fetch(videoUrls[i]);
            const buffer = await response.arrayBuffer();
            fs.writeFileSync(localPath, Buffer.from(buffer));
            inputFiles.push(localPath);
            console.log(`✅ Saved clip ${i}`);
        }

        // 2. Prepare for Stitching
        const outputPath = path.join(tempDir, `${runId}_final.mp4`);
        const listFile = path.join(tempDir, `${runId}_list.txt`);

        // Create FFmpeg concat list file
        const listContent = inputFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
        fs.writeFileSync(listFile, listContent);

        // 3. Run FFmpeg directly
        // Path verified from check-ffmpeg.js
        // Resolve FFmpeg path dynamically
        const ffmpegPath = ffmpegInstaller.path;
        console.log('🎞️ Running FFmpeg from:', ffmpegPath);

        const args = [
            '-f', 'concat',
            '-safe', '0',
            '-i', listFile,
            '-vf', "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Created with KogFlow.app':fontcolor=white:fontsize=36:box=1:boxcolor=black@0.4:boxborderw=10:x=(w-text_w)/2:y=h-text_h-40",
            '-r', '30',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '22',
            '-b:v', '5000k',
            '-c:a', 'aac',
            '-pix_fmt', 'yuv420p',
            outputPath
        ];

        const result = spawnSync(ffmpegPath, args);

        if (result.error) throw result.error;
        if (result.status !== 0) {
            console.error('FFmpeg Error Result:', result.stderr.toString());
            throw new Error(`FFmpeg exited with code ${result.status}: ${result.stderr}`);
        }

        console.log('✅ Stitching complete!');

        // 4. Upload to Supabase
        const fileBuffer = fs.readFileSync(outputPath);
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const fileName = `${userId}/${projectId}/${runId}.mp4`;
        const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('videos')
            .upload(fileName, fileBuffer, {
                contentType: 'video/mp4',
                upsert: true
            });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase
            .storage
            .from('videos')
            .getPublicUrl(fileName);

        // Cleanup
        inputFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
        if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        return NextResponse.json({ success: true, videoUrl: publicUrl });

    } catch (error: any) {
        console.error('❌ Stitching error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
