import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } from '@discordjs/voice';
import play from 'play-dl';
import ytdl from '@distube/ytdl-core';
import DiscordUtilityService from '#root/services/DiscordUtilityService.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } from 'discord.js';

// new
import prism from 'prism-media';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
const { Lame: lame } = await import('node-lame');

let connection;
let player;
let queue = [];
let isQueueProcessing = false;
let currentVideo = null; // Track the currently playing video
let nowPlayingMessage = null; // Add this to track the now playing message
let updateInterval = null; // Add this to track the update interval
let volumeLevel = 5;
let statusStymbol = '▶';
let currentMessage = null; // Track the current message being processed

// Add these variables at the top with your other variables
let recordingStreams = new Map();
let isRecording = false;
let combinedStream = null;
let audioMixer = null;

// Simple audio mixer class
class AudioMixer {
    constructor(outputStream) {
        this.outputStream = outputStream;
        this.sources = new Map();
        this.mixInterval = null;
        this.bufferSize = 3840; // 20ms of 48kHz stereo 16-bit audio
        this.startMixing();
    }

    addSource(id, stream) {
        this.sources.set(id, {
            stream,
            buffer: Buffer.alloc(0)
        });

        stream.on('data', (chunk) => {
            const source = this.sources.get(id);
            if (source) {
                source.buffer = Buffer.concat([source.buffer, chunk]);
            }
        });

        stream.on('end', () => {
            this.sources.delete(id);
            if (this.sources.size === 0) {
                this.stopMixing();
            }
        });
    }

    startMixing() {
        this.mixInterval = setInterval(() => {
            if (this.sources.size === 0) return;

            const mixed = Buffer.alloc(this.bufferSize);
            let activeStreams = 0;

            for (const [id, source] of this.sources) {
                if (source.buffer.length >= this.bufferSize) {
                    activeStreams++;
                    const chunk = source.buffer.slice(0, this.bufferSize);
                    source.buffer = source.buffer.slice(this.bufferSize);

                    // Mix audio by averaging samples
                    for (let i = 0; i < this.bufferSize; i += 2) {
                        const sample = chunk.readInt16LE(i);
                        const mixedSample = mixed.readInt16LE(i);
                        mixed.writeInt16LE(mixedSample + sample, i);
                    }
                }
            }

            // Normalize mixed audio
            if (activeStreams > 0) {
                for (let i = 0; i < this.bufferSize; i += 2) {
                    const sample = mixed.readInt16LE(i);
                    mixed.writeInt16LE(Math.floor(sample / activeStreams), i);
                }
                this.outputStream.write(mixed);
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

    destroy() {
        this.stopMixing();
        this.sources.clear();
    }
}

function createEmbed(video, queueMessage) {
    const videoUrl = video.url;
    const videoTitle = video.title;
    const videoDescription = video.description;
    const videoDuration = video.durationRaw;
    const videoViews = video.views;
    const channelName = video.channel.name;
    const videoThumbnail = video.thumbnails[1] ? video.thumbnails[1].url : video.thumbnails[0].url;


    // message.reply(`Now playing: **${video.title}** (${video.durationRaw}), requested by ${video.author}`);

    const username = DiscordUtilityService.getNameFromItem(queueMessage);
    const userProfilePicture = queueMessage.author.displayAvatarURL();

    let formatted = '0:00';
    if (player.state?.resource?.playbackDuration) {
        const milliseconds = player.state.resource.playbackDuration;
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // formatted message with embed
    const embed = {
        color: 0x0099ff,
        title: `Now Playing`,
        url: videoUrl,
        description: videoTitle,
        fields: [
            { name: '', value: '', inline: false },
            { name: '', value: `Volume: ${volumeLevel}%` },
            // { name: 'Currently Playing', value: videoTitle, inline: false },
            // { name: 'Duration', value: `${formatted} / ${videoDuration}`, inline: false },
            // { name: 'Duration', value: videoDuration, inline: true },
            // { name: 'Views', value: videoViews.toString(), inline: true },
            // { name: 'Channel', value: channelName, inline: true },
        ],
        footer: {
            text: `${statusStymbol} ${formatted} / ${videoDuration}`,
            // icon_url: userProfilePicture,
        },
        author: queueMessage.author,
        image: {
            url: videoThumbnail,
        },
        // thumbnail: {
        //     url: videoThumbnail,
        // },
    };

    // add a field with the name "Up Next:" and the value of all the next songs in the queue
    if (queue.length > 0) {
        const nextSongs = queue.map((item, index) => `${index + 1}. ${item.video.title} (${item.video.durationRaw})`).join('\n');
        embed.fields.push({
            name: 'Up Next:',
            value: nextSongs,
            inline: false,
        });
    } else {
        embed.fields.push({
            name: 'Up Next',
            value: 'No songs in the queue.',
            inline: false,
        });
    }
    return embed;
}



const YouTubeWrapper = {
    async processQueue(client, message) {
        if (queue.length === 0) {
            isQueueProcessing = false;
            return;
        }
        const { video, message: queueMessage } = queue.shift();
        currentVideo = video;
        currentMessage = queueMessage;
        try {
            // Join voice channel if not already connected
            if (!connection || connection.state.status === 'disconnected') {
                connection = joinVoiceChannel({
                    channelId: message.member.voice.channel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });
            }

            // Create player if not exists
            if (!player) {
                player = createAudioPlayer();
                connection.subscribe(player);
            }

            const info = await ytdl.getInfo(video.url);


            // if info.formats hasAudio
            // pick highest audioBitrate in info.formats
            if (!info.formats.some(format => format.hasAudio)) {
                return await message.reply('No audio format found for this video!');
            } else {
                console.log('Audio format found!');
            }
            const audioFormats = info.formats.filter(format => format.hasAudio);
            const highestAudioBitrate = Math.max(...audioFormats.map(format => format.audioBitrate));
            const selectedFormat = audioFormats.find(format => format.audioBitrate === highestAudioBitrate);


            const stream = ytdl(video.url, {
                filter: 'audio',
                quality: selectedFormat.itag,
                // quality: 'highestaudio',
                // highWaterMark: 1 << 25, // 32MB
                // liveBuffer: 1 << 25, // 32MB
                highWaterMark: 1,
                // liveBuffer: 1 << 62, // 4GB
                dlChunkSize: 0,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept-Language': 'en-US,en;q=0.9',
                    },
                    family: 4, // Force IPv4, or 6 for IPv6
                },
            });

            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true,
                metadata: video,
            });

            resource.volume.setVolume(volumeLevel / 100);

            // Remove all previous listeners to avoid duplicates
            player.removeAllListeners();

            // Add error handler
            player.on('error', async error => {
                console.error('Player error:', error);
                await message.channel.send('An error occurred while streaming the song, now skipping to the next song...');
                this.stopUpdateInterval();
                await this.processQueue(client, message);
            });

            player.on(AudioPlayerStatus.Idle, async () => {
                this.stopUpdateInterval();
                await this.processQueue(client, message);
            });

            player.play(resource);

            const embed = createEmbed(video, queueMessage);

            nowPlayingMessage = await message.channel.send({ embeds: [embed] });
            this.startUpdateInterval();
        } catch (error) {
            console.error('Error processing queue:', error);
            message.reply('An error occurred while processing the queue!');
            isQueueProcessing = false;
            connection.destroy();
            connection = null;
        }
    },
    async searchAndPlay(client, message) {
        if (!message.content.startsWith('!play ')) return;
        try {
            const permissions = message.member.voice.channel.permissionsFor(client.user);
            if (!permissions.has(['CONNECT', 'SPEAK'])) {
                return message.reply('I need permissions to join and speak in your voice channel!');
            }

            message.content = message.content.slice(6).trim(); // Remove '!play ' prefix

            let video;

            if (message.content.includes('youtube.com/watch') || message.content.includes('youtu.be/')) {
                if (!ytdl.validateURL(message.content)) {
                    return message.reply('Invalid YouTube URL!');
                }
                // Get video info using play-dl
                const basicInfo = await play.video_basic_info(message.content);
                video = basicInfo.video_details;
            } else {
                const query = message.content;
                if (!message.member.voice.channel) {
                    return message.reply('You need to be in a voice channel!');
                }
                const searchResults = await play.search(query, { limit: 1 });
                if (searchResults.length === 0) {
                    return message.reply('No results found!');
                }

                video = searchResults[0];
            }

            const queueObject = {
                video,
                message,
            }
            queue.push(queueObject);

            // Add message when song is added to queue
            if (isQueueProcessing) {
                const milliseconds = player.state.resource.playbackDuration;
                const totalSeconds = Math.floor(milliseconds / 1000);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                // grab existing message embed and resend it with updated fields
                const existingEmbed = nowPlayingMessage.embeds[0];
                const updatedEmbed = {
                    color: existingEmbed.color,
                    title: existingEmbed.title,
                    url: existingEmbed.url,
                    description: existingEmbed.description,
                    fields: [{
                        name: '',
                        value: `Volume: ${volumeLevel}%`,
                    }],
                    footer: existingEmbed.footer,
                    author: existingEmbed.author,
                    image: existingEmbed.image,
                };


                if (queue.length > 0) {
                    const nextSongs = queue.map((item, index) => `${index + 1}. ${item.video.title} (${item.video.durationRaw})`).join('\n');
                    updatedEmbed.fields.push({
                        name: 'Up Next',
                        value: nextSongs,
                        inline: false,
                    });
                }

                message.reply(`Added to queue: **${video.title}** (${video.durationRaw}) - Position #${queue.length}`);
                nowPlayingMessage = await message.channel.send({ embeds: [updatedEmbed] });

                // stop the update interval if it's running
                if (updateInterval) {
                    clearInterval(updateInterval);
                    updateInterval = null;
                }

                // start a new update interval
                this.startUpdateInterval();
            }

            if (!isQueueProcessing) {
                isQueueProcessing = true;
                await this.processQueue(client, message);
            }
        } catch (error) {
            console.error('Error:', error);
            message.reply('An error occurred while searching/playing!');
        }
    },
    async recordVoiceInVoiceChannel(client, message) {
        if (!message.content.startsWith('!record')) return;
        if (!message.member.voice.channel) {
            return message.reply('You need to be in a voice channel!');
        }

        if (!connection || connection.state.status === 'disconnected') {
            connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: false, // Important: bot needs to hear
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

        // Create recordings directory if it doesn't exist
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
            if (isRecording) {
                this.createRecordingStream(receiver, userId, recordingsDir);
            }
        });

        isRecording = true;

        // Start recording for all users currently in the voice channel
        const voiceChannel = message.member.voice.channel;
        voiceChannel.members.forEach(member => {
            if (!member.user.bot) { // Don't record bots
                this.createRecordingStream(receiver, member.id, recordingsDir);
            }
        });

        const replyMessage = await message.reply('🔴 Recording started for the next **5 seconds**!');

        setTimeout(() => {
            if (isRecording) {
                isRecording = false;
                // message.reply('🟥 Recording stopped! Check the recordings folder for your MP3 files.');

                // Stop all active recordings
                for (const [userId, streams] of recordingStreams) {
                    if (streams.opusStream && !streams.opusStream.destroyed) {
                        streams.opusStream.destroy();
                    }
                    if (streams.decoder) {
                        streams.decoder.destroy();
                    }
                    if (streams.outputStream) {
                        streams.outputStream.end();
                    }
                }
                recordingStreams.clear();

                // Stop the audio mixer and convert combined file
                if (audioMixer) {
                    audioMixer.destroy();
                    audioMixer = null;

                    // Wait a bit for the stream to finish writing
                    setTimeout(async () => {
                        const stats = fs.statSync(combinedPcmPath);
                        if (stats.size > 0) {
                            try {
                                await this.convertToMp3(combinedPcmPath, combinedMp3Path);


                                let userTags = voiceChannel.members.map(member => `<@${member.user.id}>`).join(', ').replace(`<@${client.user.id}>`, '');
                                // if there is only two users, remove the comma
                                if (userTags.endsWith(', ')) {
                                    userTags = userTags.slice(0, -2);
                                }

                                const attachment = new AttachmentBuilder(combinedMp3Path);
                                const embed = new EmbedBuilder()
                                    .setTitle('Audio Recording')
                                    .setDescription(`Requested by <@${message.author.id}> in <#${voiceChannel.id}>`)
                                    .addFields({ name: 'Users Recorded', value: userTags || 'No users recorded' })
                                    .setColor('#00FF00')
                                // .setTimestamp()
                                // .setFooter({ text: 'Recording Bot' });

                                await replyMessage.edit({ content: '', embeds: [embed], files: [attachment] });

                            } catch (error) {
                                console.error('Failed to convert combined recording:', error);
                            }
                        } else {
                            fs.unlinkSync(combinedPcmPath);
                        }
                    }, 1000);
                }
            }
        }, 5000); // 30 seconds
    },
    // Add this new function to handle the recording stream
    createRecordingStream(receiver, userId, recordingsDir) {
        if (recordingStreams.has(userId) || !isRecording) return;

        try {
            const opusStream = receiver.subscribe(userId, {
                end: {
                    behavior: 'afterSilence',
                    duration: 100,
                },
            });

            if (!opusStream) {
                console.log(`Failed to subscribe to user ${userId}`);
                return;
            }

            // Create a decoder to convert Opus to raw PCM
            const decoder = new prism.opus.Decoder({
                frameSize: 960,
                channels: 2,
                rate: 48000,
            });

            // Create a second decoder for the mixer (we need two separate streams)
            const mixerDecoder = new prism.opus.Decoder({
                frameSize: 960,
                channels: 2,
                rate: 48000,
            });

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
            });

            // Pipe to individual file
            opusStream
                .pipe(decoder)
                .pipe(outputStream)
                .on('finish', async () => {
                    console.log(`Recording saved for user ${userId}`);
                    const stats = fs.statSync(pcmPath);
                    if (stats.size > 0) {
                        try {
                            await this.convertToMp3(pcmPath, mp3Path);
                        } catch (error) {
                            console.error(`Failed to convert recording for user ${userId}:`, error);
                        }
                    } else {
                        console.log(`Empty recording for user ${userId}, deleting...`);
                        fs.unlinkSync(pcmPath);
                    }
                    recordingStreams.delete(userId);
                });

            // Also pipe to the mixer for combined recording
            if (audioMixer) {
                const mixerStream = receiver.subscribe(userId, {
                    end: {
                        behavior: 'afterSilence',
                        duration: 100,
                    },
                });

                if (mixerStream) {
                    mixerStream.pipe(mixerDecoder);
                    audioMixer.addSource(userId, mixerDecoder);
                }
            }

            // Add error handling
            opusStream.on('error', (error) => {
                console.error(`OpusStream error for user ${userId}:`, error);
                recordingStreams.delete(userId);
            });

            decoder.on('error', (error) => {
                console.error(`Decoder error for user ${userId}:`, error);
                recordingStreams.delete(userId);
            });

            outputStream.on('error', (error) => {
                console.error(`Output stream error for user ${userId}:`, error);
                recordingStreams.delete(userId);
            });

        } catch (error) {
            console.error(`Error creating recording stream for user ${userId}:`, error);
        }
    },
    // And here's a simpler convertToMp3 function using fluent-ffmpeg:
    async convertToMp3(pcmPath, mp3Path) {
        const { default: ffmpeg } = await import('fluent-ffmpeg');

        console.log(`Converting PCM to MP3: ${pcmPath} -> ${mp3Path}`);

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
                    console.log(`MP3 saved: ${mp3Path}`);
                    fs.unlinkSync(pcmPath);
                    resolve(mp3Path);
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(err);
                })
                .run();
        });
    },
    startUpdateInterval() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }

        updateInterval = setInterval(() => {
            // if (!player || player.state.status !== AudioPlayerStatus.Playing || !nowPlayingMessage) {
            //     this.stopUpdateInterval();
            //     return;
            // }

            // empty bar with 45 spaces
            let progressBar = '░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░';
            let dividingLine = '───────────────────────────────────────────';

            let volumeBar = '░░░░░░░░░░░░';

            const progress = player.state.resource.playbackDuration / (currentVideo.durationInSec * 1000);
            const filledLength = Math.floor(progress * progressBar.length);
            progressBar = progressBar.substring(0, filledLength).replace(/░/g, '█') + progressBar.substring(filledLength);

            const milliseconds = player.state.resource.playbackDuration;
            const totalSeconds = Math.floor(milliseconds / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            dividingLine = dividingLine.slice(formatted.length).slice(currentVideo.durationRaw.length);

            // replace volumeBar ░ with █ based on volumeLevel
            const volumeFilledLength = Math.floor((volumeLevel / 100) * volumeBar.length);
            volumeBar = volumeBar.substring(0, volumeFilledLength).replace(/░/g, '█') + volumeBar.substring(volumeFilledLength);

            const dox = `\`\`\`
${progressBar}
${formatted} ${dividingLine} ${currentVideo.durationRaw}
\`\`\``;

            const vol = `\`\`\`
🔊 ${volumeBar} ${volumeLevel}%
\`\`\``;

            // Create a completely new embed object
            const existingEmbed = nowPlayingMessage.embeds[0];
            const updatedEmbed = {
                color: existingEmbed.color,
                title: existingEmbed.title,
                url: existingEmbed.url,
                // description: existingEmbed.description,
                description: existingEmbed.description,
                fields: [
                    {
                        name: '',
                        value: dox,
                    },
                    // {
                    //     name: '',
                    //     value: vol,
                    //     inline: true,
                    // },
                    {
                        name: '',
                        value: `\`🔊 ${volumeLevel}% | Queue: ${queue.length} | Requested by @${DiscordUtilityService.getNameFromItem(currentMessage)}\``,
                        inline: true,
                    },
                    // {
                    //     name: '',
                    //     value: '',
                    //     inline: true,
                    // }
                ],
                author: existingEmbed.author,
                image: existingEmbed.image,
                // footer: {
                //     text: `${statusStymbol} ${formatted} / ${currentVideo.durationRaw}`,
                // }
            };

            if (queue.length > 0) {
                const nextSongs = queue.map((item, index) => `\`${index + 1}. ${item.video.title} (${item.video.durationRaw}) @${DiscordUtilityService.getNameFromItem(item.message)}\``).join('\n');
                updatedEmbed.fields.push({
                    name: 'Up Next',
                    value: nextSongs,
                    inline: false,
                });
            } else {
                updatedEmbed.fields.push({
                    name: 'Up Next',
                    value: 'No songs in the queue.',
                    inline: false,
                });
            }



            let actionRow = new ActionRowBuilder()
            // if is paused change button to resume

            const isThereANextSong = queue.length > 0;

            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('empty')
                    .setLabel('⠀⠀⠀⠀⠀⠀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('back')
                    .setLabel('⏮️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true)
            );
            if (player.state.status === AudioPlayerStatus.Playing || player.state.status === AudioPlayerStatus.Buffering) {
                actionRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId('pause')
                        .setLabel('⏸️')
                        .setStyle(ButtonStyle.Primary),
                );
            } else {
                actionRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId('resume')
                        .setLabel('▶️')
                        .setStyle(ButtonStyle.Primary)
                );
            }
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('⏭️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!isThereANextSong)
            );
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId('empty2')
                    .setLabel('⠀⠀⠀⠀⠀⠀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
            const volumeRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('empty3')
                        .setLabel('⠀⠀')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('volumeDown')
                        .setLabel('Volume Down ⬇️')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('volumeLevel')
                        .setLabel(`🔊 ${volumeLevel.toString()}%`)
                        .setStyle(ButtonStyle.Secondary)
                        // .setEmoji('744928265009103008')
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('volumeUp')
                        .setLabel('⬆️ Volume Up')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('empty4')
                        .setLabel('⠀⠀')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    // new ButtonBuilder()
                    //     .setCustomId('volumeMute')
                    //     .setLabel('🔇 Mute')
                    //     .setStyle(ButtonStyle.Secondary),
                );



            nowPlayingMessage.edit({ embeds: [updatedEmbed], components: [actionRow, volumeRow] }).catch(err => {
                console.error('Failed to update embed:', err);
                this.stopUpdateInterval();
            });
        }, 1000);
    },

    stopUpdateInterval() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        nowPlayingMessage = null;
    },
    async stop(client, message) {
        if (!message.content.startsWith('!stop')) return;

        if (player) {
            player.stop();
        }
        if (connection) {
            connection.destroy();
            connection = null;
        }
        this.stopUpdateInterval();
        player = null;
        queue = [];
        isQueueProcessing = false;

        await message.reply('Stopped playing!');
    },

    async next(client, message) {
        if (!message.content.startsWith('!skip') && !message.content.startsWith('!next')) return;

        if (!player || queue.length === 0) {
            return message.reply('No song is currently playing or the queue is empty!');
        }

        // Stop current song and move to next
        player.stop();
    },

    async pause(client, message) {
        if (!message.content.startsWith('!pause')) return;
        if (!player) return message.reply('No song is currently playing!');

        player.pause();
        await message.reply('Paused!');
    },

    async resume(client, message) {
        if (!message.content.startsWith('!resume')) return;
        if (!player) return message.reply('No song is currently playing!');

        player.unpause();
        message.reply('Resumed!');
    },
    async setVolume(client, message) {
        if (!message.content.startsWith('!volume ')) return;
        if (!player) return message.reply('No song is currently playing!');

        const args = message.content.split(' ');
        if (args.length !== 2 || isNaN(args[1]) || args[1] < 0 || args[1] > 100) {
            return message.reply('Please provide a valid volume between 0 and 100.');
        }

        volumeLevel = parseInt(args[1], 10);

        // Get the current resource from the player
        if (player.state.status === AudioPlayerStatus.Playing && player.state.resource.volume) {
            player.state.resource.volume.setVolume(volumeLevel / 100);
            message.reply(`Volume set to ${volumeLevel}%`);

            // Create a completely new embed object
            const existingEmbed = nowPlayingMessage.embeds[0];
            const updatedEmbed = {
                color: existingEmbed.color,
                title: existingEmbed.title,
                url: existingEmbed.url,
                description: existingEmbed.description,
                fields: [
                    {
                        name: '',
                        value: '',
                    },
                    {
                        name: '',
                        value: `Volume: ${volumeLevel}%`,
                    }
                ],
                author: existingEmbed.author,
                image: existingEmbed.image,
                footer: existingEmbed.footer,
            };

            if (queue.length > 0) {
                const nextSongs = queue.map((item, index) => `${index + 1}. ${item.video.title} (${item.video.durationRaw})`).join('\n');
                updatedEmbed.fields.push({
                    name: 'Up Next',
                    value: nextSongs,
                    inline: false,
                });
            } else {
                updatedEmbed.fields.push({
                    name: 'Up Next',
                    value: 'No songs in the queue.',
                    inline: false,
                });
            }

            nowPlayingMessage = await message.channel.send({ embeds: [updatedEmbed] });

            // stop the update interval if it's running
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }

            // start a new update interval
            this.startUpdateInterval();

        } else {
            message.reply('Cannot adjust volume at this time.');
        }
    },
    async setVolumeByAmount(amount) {
        if (!player) return;
        volumeLevel = Math.min(volumeLevel + amount, 100);
        player.state.resource.volume.setVolume(volumeLevel / 100);
        return volumeLevel;
    },
    // async buttonStop() {
    //     if (player) {
    //         player.stop();
    //     }
    //     if (connection) {
    //         connection.destroy();
    //         connection = null;
    //     }
    //     this.stopUpdateInterval();
    //     player = null;
    //     queue = [];
    //     isQueueProcessing = false;
    // },
    async buttonSkip() {
        if (!player || queue.length === 0) {
            return;
        }

        // Stop current song and move to next
        player.stop();
    },
    async buttonPause() {
        if (!player) return;
        player.pause();
    },
    async buttonResume() {
        if (!player) return;
        player.unpause();
    },
    async buttonNext() {
        if (!player || queue.length === 0) {
            return;
        }

        // if player is paused, resume it
        if (player.state.status === AudioPlayerStatus.Paused) {
            player.unpause();
        }
        // Stop current song and move to next
        player.stop();
    },
    async getCurrentTimePlayed(client, message) {
        if (!message.content.startsWith('!time')) return;
        if (!player) return message.reply('No song is currently playing!');

        const currentTime = player.state.resource.playbackDuration;
        const totalDuration = player.state.resource.metadata.duration;

        message.reply(`Current time: ${formatTime(currentTime)} / ${formatTime(totalDuration)}`);
    },
};

export default YouTubeWrapper;