import 'dotenv/config';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import prism from 'prism-media';
import { joinVoiceChannel } from '@discordjs/voice';
const recordingStreams = new Map();
import OpenAIWrapper from '#/wrappers/OpenAIWrapper.js';

let isRecording = false;
let combinedStream = null;
let audioMixer = null;
let connection = null;
let transcriptions = []; // Array to store transcriptions with timestamps

class UserRecordingStream {
    constructor(userId, username, recordingsDir) {
        this.userId = userId;
        this.username = username;
        this.recordingsDir = recordingsDir;
        this.audioBuffer = Buffer.alloc(0);
        this.isSpeaking = false;
        this.silenceFrames = 0;
        this.speechStartTime = null;
        this.segmentCount = 0;

        // Adjusted thresholds for Discord audio
        this.SILENCE_THRESHOLD = 25;
        this.MIN_SPEECH_DURATION = 200;
        this.VOICE_THRESHOLD = 300;
        this.MAX_SILENCE_RMS = 100;

        // Add tracking for processed segments
        this.processedSegments = new Set();
        this.lastProcessedTime = 0;

        // Buffer management
        this.currentSegmentBuffer = Buffer.alloc(0);
        this.frameCount = 0;

        // Add finalization tracking
        this.isFinalized = false;
        this.processingSegment = false;
    }

    async processAudioChunk(chunk) {
        // Don't process if already finalized
        if (this.isFinalized) return;

        this.frameCount++;

        // Calculate audio statistics
        const audioStats = this.calculateAudioStats(chunk);
        const hasAudio = audioStats.rms > this.VOICE_THRESHOLD || audioStats.maxAmplitude > 1500;
        const isSilent = audioStats.rms < this.MAX_SILENCE_RMS;

        // Debug logging every 50 frames (~1 second)
        if (this.frameCount % 50 === 0) {
            console.log(`[${this.username}] RMS: ${audioStats.rms.toFixed(0)}, ` +
                `Max: ${audioStats.maxAmplitude}, Speaking: ${this.isSpeaking}, ` +
                `Silence frames: ${this.silenceFrames}`);
        }

        if (hasAudio && !this.isSpeaking) {
            // Start of speech
            this.isSpeaking = true;
            this.speechStartTime = Date.now();
            this.silenceFrames = 0;
            this.currentSegmentBuffer = chunk;
            console.log(`[${this.username}] Speech started at ${new Date().toISOString()}`);

        } else if (this.isSpeaking) {
            // Currently speaking
            this.currentSegmentBuffer = Buffer.concat([this.currentSegmentBuffer, chunk]);

            if (isSilent) {
                // Increment silence counter
                this.silenceFrames++;

                if (this.silenceFrames >= this.SILENCE_THRESHOLD) {
                    // End of speech detected
                    const speechEndTime = Date.now();
                    const duration = speechEndTime - this.speechStartTime;

                    console.log(`[${this.username}] Speech ended. Duration: ${duration}ms, ` +
                        `Buffer size: ${this.currentSegmentBuffer.length}`);

                    if (duration > this.MIN_SPEECH_DURATION &&
                        this.currentSegmentBuffer.length > 0 &&
                        (speechEndTime - this.lastProcessedTime) > 100 &&
                        !this.processingSegment) { // Prevent concurrent processing

                        // Make a copy of the buffer for transcription
                        const bufferToTranscribe = Buffer.from(this.currentSegmentBuffer);
                        const currentSpeechStartTime = this.speechStartTime;
                        const currentSegmentCount = this.segmentCount;

                        // Increment segment count BEFORE transcription
                        this.segmentCount++;

                        // Process transcription asynchronously
                        this.transcribeSegment(bufferToTranscribe, currentSpeechStartTime, currentSegmentCount);
                        this.lastProcessedTime = speechEndTime;
                    }

                    // Reset state
                    this.isSpeaking = false;
                    this.currentSegmentBuffer = Buffer.alloc(0);
                    this.silenceFrames = 0;
                }
            } else {
                // Still speaking, reset silence counter
                this.silenceFrames = 0;
            }
        }
    }

    calculateAudioStats(chunk) {
        if (chunk.length < 2) {
            return { rms: 0, maxAmplitude: 0, avgAmplitude: 0 };
        }

        let sum = 0;
        let maxAmplitude = 0;
        let totalAmplitude = 0;
        const samples = Math.floor(chunk.length / 2);

        for (let i = 0; i < chunk.length - 1; i += 2) {
            const sample = chunk.readInt16LE(i);
            sum += sample * sample;
            maxAmplitude = Math.max(maxAmplitude, Math.abs(sample));
            totalAmplitude += Math.abs(sample);
        }

        return {
            rms: Math.sqrt(sum / samples),
            maxAmplitude: maxAmplitude,
            avgAmplitude: totalAmplitude / samples
        };
    }

    async transcribeSegment(audioBuffer, speechStartTime, segmentNumber) {
        // Prevent concurrent segment processing
        if (this.processingSegment) return;
        this.processingSegment = true;

        try {
            // Create unique identifier for this segment
            const segmentId = `${this.userId}-${speechStartTime}-${segmentNumber}`;

            // Check if already processed
            if (this.processedSegments.has(segmentId)) {
                console.log(`[${this.username}] Skipping duplicate segment ${segmentId}`);
                return;
            }

            this.processedSegments.add(segmentId);

            const timestamp = Date.now();
            const segmentFilename = `${this.userId}-seg${segmentNumber}-${timestamp}.pcm`;
            const pcmPath = path.join(this.recordingsDir, segmentFilename);
            const mp3Path = pcmPath.replace('.pcm', '.mp3');

            console.log(`[${this.username}] Saving segment ${segmentNumber}, ` +
                `size: ${audioBuffer.length} bytes`);

            // Write PCM data
            fs.writeFileSync(pcmPath, audioBuffer);

            // Convert to MP3
            await convertToMp3(pcmPath, mp3Path);

            // Check file size before transcription
            const mp3Stats = fs.statSync(mp3Path);
            if (mp3Stats.size < 1000) { // Skip very small files
                console.log(`[${this.username}] Skipping small file (${mp3Stats.size} bytes)`);
                fs.unlinkSync(mp3Path);
                return;
            }

            // Transcribe the segment
            console.log(`[${this.username}] Transcribing segment ${segmentNumber}...`);
            const transcription = await OpenAIWrapper.speechToText(fs.createReadStream(mp3Path));

            if (transcription && transcription.trim().length > 0) {
                const transcriptionEntry = {
                    userId: this.userId,
                    username: this.username,
                    timestamp: new Date(speechStartTime).toISOString(),
                    duration: (Date.now() - speechStartTime) / 1000,
                    text: transcription.trim(),
                    segmentNumber: segmentNumber,
                    segmentId: segmentId
                };

                // Check for duplicate transcriptions with more specific criteria
                const isDuplicate = transcriptions.some(t =>
                    t.segmentId === segmentId || // Same segment ID
                    (t.userId === this.userId &&
                        t.segmentNumber === segmentNumber) // Same user and segment number
                );

                if (!isDuplicate) {
                    transcriptions.push(transcriptionEntry);
                    console.log(`[${this.username}] Transcribed segment ${segmentNumber}: "${transcription.trim()}"`);
                } else {
                    console.log(`[${this.username}] Skipping duplicate transcription for segment ${segmentNumber}`);
                }
            }

            // Clean up
            if (fs.existsSync(mp3Path)) {
                fs.unlinkSync(mp3Path);
            }

        } catch (error) {
            console.error(`[${this.username}] Error transcribing segment ${segmentNumber}:`, error);
        } finally {
            this.processingSegment = false;
        }
    }

    async finalize() {
        // Prevent multiple finalizations
        if (this.isFinalized) {
            console.log(`[${this.username}] Already finalized, skipping.`);
            return;
        }

        this.isFinalized = true;

        console.log(`[${this.username}] Finalizing. Speaking: ${this.isSpeaking}, ` +
            `Buffer size: ${this.currentSegmentBuffer.length}`);

        // Wait for any ongoing segment processing to complete
        while (this.processingSegment) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (this.isSpeaking && this.currentSegmentBuffer.length > 0) {
            const bufferToTranscribe = Buffer.from(this.currentSegmentBuffer);
            const currentSpeechStartTime = this.speechStartTime;
            const currentSegmentCount = this.segmentCount;

            await this.transcribeSegment(bufferToTranscribe, currentSpeechStartTime, currentSegmentCount);
        }
    }
}


// Modified createRecordingStream function
function createRecordingStream(receiver, userId, recordingsDir, guild) {
    if (recordingStreams.has(userId) || !isRecording) return;

    try {
        const member = guild.members.cache.get(userId);
        const username = member ? member.displayName : `User ${userId}`;

        const opusStream = receiver.subscribe(userId, {
            end: {
                behavior: 'manual',
            },
        });

        if (!opusStream) {
            console.log(`Failed to subscribe to user ${userId}`);
            return;
        }

        // Create decoder with consistent settings
        const decoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: 48000,
        });

        // Create user recording stream
        const userRecordingStream = new UserRecordingStream(userId, username, recordingsDir);

        // Individual recording file
        const filename = `${userId}-${Date.now()}.pcm`;
        const pcmPath = path.join(recordingsDir, filename);
        const mp3Path = pcmPath.replace('.pcm', '.mp3');
        const outputStream = fs.createWriteStream(pcmPath);

        recordingStreams.set(userId, {
            opusStream,
            decoder,
            outputStream,
            pcmPath,
            mp3Path,
            userRecordingStream,
        });

        // Create a separate decoder for transcription processing
        const transcriptionDecoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: 48000,
        });

        // Pipe for transcription processing
        opusStream
            .pipe(transcriptionDecoder)
            .on('data', (chunk) => {
                userRecordingStream.processAudioChunk(chunk);
            });

        // Pipe for file recording
        opusStream
            .pipe(decoder)
            .pipe(outputStream)
            .on('finish', async () => {
                console.log(`Recording saved for user ${userId}`);

                // Finalize transcriptions
                await userRecordingStream.finalize();

                const stats = fs.statSync(pcmPath);
                if (stats.size > 0) {
                    try {
                        await convertToMp3(pcmPath, mp3Path);
                    } catch (error) {
                        console.error(`Failed to convert recording for user ${userId}:`, error);
                    }
                } else {
                    console.log(`Empty recording for user ${userId}, deleting...`);
                    fs.unlinkSync(pcmPath);
                }
                recordingStreams.delete(userId);
            });

        // Also add to mixer for combined recording
        if (audioMixer) {
            const mixerStream = receiver.subscribe(userId, {
                end: {
                    behavior: 'manual',
                },
            });

            if (mixerStream) {
                const mixerDecoder = new prism.opus.Decoder({
                    frameSize: 960,
                    channels: 2,
                    rate: 48000,
                });

                mixerStream.pipe(mixerDecoder);
                audioMixer.addSource(userId, mixerDecoder);
            }
        }

        // Error handling
        transcriptionDecoder.on('error', (error) => {
            console.error(`Transcription decoder error for user ${userId}:`, error);
        });

        opusStream.on('error', (error) => {
            console.error(`OpusStream error for user ${userId}:`, error);
            recordingStreams.delete(userId);
        });

        decoder.on('error', (error) => {
            console.error(`Decoder error for user ${userId}:`, error);
            recordingStreams.delete(userId);
        });

    } catch (error) {
        console.error(`Error creating recording stream for user ${userId}:`, error);
    }
}

function formatTranscriptions() {
    if (transcriptions.length === 0) {
        return "No speech detected during recording.";
    }

    // Sort by timestamp
    transcriptions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Format for display
    let formatted = "";
    let lastUserId = null;

    for (const trans of transcriptions) {
        const time = new Date(trans.timestamp).toLocaleTimeString();

        // Add a separator if switching speakers
        if (lastUserId && lastUserId !== trans.userId) {
            formatted += "---\n";
        }

        formatted += `**${trans.username}** [${time}] (${trans.duration.toFixed(1)}s): ${trans.text}\n\n`;
        lastUserId = trans.userId;
    }

    return formatted;
}

const DiscordVoiceService = {
    async recordVoiceInVoiceChannel2(interaction, seconds) {
        const secondsInMs = seconds * 1000;

        // Reset transcriptions array
        transcriptions = [];

        if (!interaction.member.voice.channel) {
            return interaction.reply('You need to be in a voice channel!');
        }

        // Check if already recording
        if (isRecording && recordingStreams.size > 0) {
            return interaction.reply('🔴 Already recording! Please wait for the current recording to finish.');
        }

        // Setup connection
        if (!connection || connection.state.status === 'disconnected') {
            connection = joinVoiceChannel({
                channelId: interaction.member.voice.channel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
        }

        // Wait for connection to be ready
        await new Promise((resolve) => {
            if (connection.state.status === 'ready') {
                resolve();
            } else {
                connection.on('stateChange', (oldState, newState) => {
                    if (newState.status === 'ready') {
                        resolve();
                    }
                });
            }
        });

        const receiver = connection.receiver;

        // Create recordings directory
        const recordingsDir = path.join(import.meta.dirname, '../recordings');
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }

        // Create combined recording stream
        const combinedFilename = `combined-${Date.now()}.pcm`;
        const combinedPcmPath = path.join(recordingsDir, combinedFilename);
        const combinedMp3Path = combinedPcmPath.replace('.pcm', '.mp3');
        combinedStream = fs.createWriteStream(combinedPcmPath);
        audioMixer = new AudioMixer(combinedStream);

        // Listen for when user starts speaking
        receiver.speaking.on('start', (userId) => {
            console.log(`User ${userId} started speaking`);
            if (isRecording && !recordingStreams.has(userId)) {
                createRecordingStream(receiver, userId, recordingsDir, interaction.guild);
            }
        });

        // Start recording for all users currently in the voice channel
        const voiceChannel = interaction.member.voice.channel;
        voiceChannel.members.forEach(member => {
            if (!member.user.bot) {
                createRecordingStream(receiver, member.id, recordingsDir, interaction.guild);
            }
        });

        isRecording = true;

        const replyMessage = await interaction.reply(`🔴 Recording started for the next **${seconds} seconds**! Transcribing speech...`);

        setTimeout(async () => {
            if (isRecording) {
                isRecording = false;

                // Wait a bit longer for audio buffers to process
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Stop all active recordings and wait for them to finish
                const stopPromises = [];
                for (const [userId, streams] of recordingStreams) {
                    if (streams.userRecordingStream) {
                        await streams.userRecordingStream.finalize();
                    }
                    if (streams.opusStream && !streams.opusStream.destroyed) {
                        streams.opusStream.destroy();
                    }
                    if (streams.decoder) {
                        streams.decoder.destroy();
                    }
                    if (streams.outputStream) {
                        // Wait for the output stream to finish writing
                        const finishPromise = new Promise((resolve) => {
                            streams.outputStream.on('finish', resolve);
                            streams.outputStream.end();
                        });
                        stopPromises.push(finishPromise);
                    }
                }

                // Wait for all individual recordings to finish
                await Promise.all(stopPromises);
                recordingStreams.clear();

                // Gracefully stop the audio mixer
                if (audioMixer) {
                    // Let the mixer finish processing any remaining data
                    await audioMixer.gracefulStop();
                    audioMixer = null;

                    // Wait for the combined stream to finish writing
                    await new Promise((resolve) => {
                        if (combinedStream.writableEnded) {
                            resolve();
                        } else {
                            combinedStream.on('finish', resolve);
                        }
                    });

                    // Additional wait to ensure file is fully written
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    const stats = fs.statSync(combinedPcmPath);
                    if (stats.size > 0) {
                        try {
                            await convertToMp3(combinedPcmPath, combinedMp3Path);

                            let userTags = voiceChannel.members
                                .filter(member => member.user.id !== interaction.client.user.id)
                                .map(member => `<@${member.user.id}>`)
                                .join(', ');

                            const attachment = new AttachmentBuilder(combinedMp3Path);
                            const embed = new EmbedBuilder()
                                .setTitle('Audio Recording with Transcription')
                                .setDescription(`Requested by <@${interaction.user.id}> in <#${voiceChannel.id}>`)
                                .addFields(
                                    { name: 'Users Recorded', value: userTags || 'No users recorded' },
                                    { name: 'Transcription', value: formatTranscriptions().substring(0, 1024) || 'No transcriptions available' }
                                )
                                .setColor('#00FF00')
                                .setTimestamp();

                            // If transcription is too long, send it as a separate message
                            const fullTranscription = formatTranscriptions();
                            if (fullTranscription.length > 1024) {
                                const transcriptionAttachment = new AttachmentBuilder(
                                    Buffer.from(fullTranscription, 'utf-8'),
                                    { name: 'transcription.txt' }
                                );
                                await replyMessage.edit({
                                    content: '',
                                    embeds: [embed],
                                    files: [attachment, transcriptionAttachment]
                                });
                            } else {
                                await replyMessage.edit({
                                    content: '',
                                    embeds: [embed],
                                    files: [attachment]
                                });
                            }

                        } catch (error) {
                            console.error('Failed to convert combined recording:', error);
                        }
                    } else {
                        fs.unlinkSync(combinedPcmPath);
                    }
                }
            }
        }, secondsInMs);
    },
}

// Keep the existing helper functions
async function convertToMp3(pcmPath, mp3Path) {
    const { default: ffmpeg } = await import('fluent-ffmpeg');

    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(pcmPath)
            .inputOptions([
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2'
            ])
            .output(mp3Path)
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .on('end', () => {
                fs.unlinkSync(pcmPath);
                resolve(mp3Path);
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                reject(err);
            })
            .run();
    });
}

class AudioMixer {
    constructor(outputStream) {
        this.outputStream = outputStream;
        this.sources = new Map();
        this.mixInterval = null;
        this.bufferSize = 3840; // 20ms of 48kHz stereo 16-bit audio
        this.silenceFrame = Buffer.alloc(this.bufferSize); // Pre-allocated silence buffer
        this.lastMixTime = Date.now();
        this.isStopping = false;
        this.startMixing();
    }

    addSource(id, stream) {
        this.sources.set(id, {
            stream,
            buffer: Buffer.alloc(0),
            lastDataTime: Date.now(),
            isActive: true
        });

        stream.on('data', (chunk) => {
            const source = this.sources.get(id);
            if (source) {
                source.buffer = Buffer.concat([source.buffer, chunk]);
                source.lastDataTime = Date.now();
                source.isActive = true;
            }
        });

        stream.on('end', () => {
            const source = this.sources.get(id);
            if (source) {
                source.isActive = false;
            }
        });
    }

    startMixing() {
        this.mixInterval = setInterval(() => {
            const now = Date.now();
            const mixed = Buffer.alloc(this.bufferSize);
            let hasActiveAudio = false;
            let hasBufferedData = false;

            // Check each source for audio or silence
            for (const [id, source] of this.sources) {
                if (source.buffer.length >= this.bufferSize) {
                    // We have audio data from this source
                    hasActiveAudio = true;
                    hasBufferedData = true;
                    const chunk = source.buffer.slice(0, this.bufferSize);
                    source.buffer = source.buffer.slice(this.bufferSize);

                    // Mix audio
                    for (let i = 0; i < this.bufferSize; i += 2) {
                        const sample = chunk.readInt16LE(i);
                        const mixedSample = mixed.readInt16LE(i);
                        const combined = mixedSample + sample;
                        // Prevent clipping
                        mixed.writeInt16LE(Math.max(-32768, Math.min(32767, combined)), i);
                    }
                } else if (source.buffer.length > 0) {
                    hasBufferedData = true;
                } else if (source.isActive && (now - source.lastDataTime) < 1000) {
                    // Source is active but no data available - user might be silent
                    // We'll write silence for this user
                    hasActiveAudio = true;
                }
            }

            // Always write something to maintain continuous stream
            if (!this.isStopping || hasBufferedData) {
                if (hasActiveAudio) {
                    // Normalize if multiple sources
                    const activeCount = Array.from(this.sources.values()).filter(s => s.isActive).length;
                    if (activeCount > 1) {
                        for (let i = 0; i < this.bufferSize; i += 2) {
                            const sample = mixed.readInt16LE(i);
                            mixed.writeInt16LE(Math.floor(sample / Math.sqrt(activeCount)), i);
                        }
                    }
                    this.outputStream.write(mixed);
                } else if (!this.isStopping) {
                    // Write silence to maintain timing
                    this.outputStream.write(this.silenceFrame);
                }
            }

            // If we're stopping and no more buffered data, end the stream
            if (this.isStopping && !hasBufferedData) {
                this.stopMixing();
            }

            // Clean up inactive sources
            for (const [id, source] of this.sources) {
                if (!source.isActive && source.buffer.length === 0) {
                    this.sources.delete(id);
                }
            }
        }, 20); // Mix every 20ms
    }

    stopMixing() {
        if (this.mixInterval) {
            clearInterval(this.mixInterval);
            this.mixInterval = null;
        }
        this.outputStream.end();
    }

    async gracefulStop() {
        this.isStopping = true;

        // Wait for mixing to complete
        await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (!this.mixInterval) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 50);

            // Timeout after 5 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                this.stopMixing();
                resolve();
            }, 5000);
        });
    }

    destroy() {
        this.stopMixing();
        this.sources.clear();
    }
}


export default DiscordVoiceService;