import WebSocket from 'ws';
import crypto from 'crypto';
const clientId = crypto.randomBytes(20).toString('hex');
import UtilityLibrary from '../libraries/UtilityLibrary.js';
const { consoleLog } = UtilityLibrary;
import config from '../config.json' with { type: 'json' };
// Formatter
import LogFormatter from '../formatters/LogFormatter.js';
import LightWrapper from '../wrappers/LightWrapper.js';

const {
    COMFY_UI_IMAGE_MODEL_API_URL,
    COMFY_UI_IMAGE_MODEL_WEBSOCKET_URL,
} = config;

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

async function downloadImage(url, imagePath) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    await pipeline(res.body, fs.createWriteStream(imagePath));
    const windowsImagePath = imagePath.replace(/^\/develop/, 'Y:').replace(/\//g, '\\');
    return windowsImagePath;
}

const debugging = false

const loadingSymbols = [
    ['♥', '♡'], ['★', '☆'], ['♦', '♢'], ['♣', '♧'], ['♠', '♤'],
    ['█', '░'], ['■', '□'], ['●', '○'], ['◆', '◇'], ['◼', '◻'],
]

function generateProgressBar(percentage) {
    const barLength = 10;
    const filled = Math.round((percentage / 100) * barLength);
    const empty = barLength - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

async function postPrompt(prompt) {
    try {
        const response = await fetch(`${COMFY_UI_IMAGE_MODEL_API_URL}/prompt`, {
            method: 'POST',
            body: JSON.stringify({ prompt: prompt, client_id: clientId }),
            headers: { 'Content-Type': 'application/json' },
        });
        return response.json();
    } catch (error) {
        return console.error('Error posting prompt:', error);
    }
}

async function getImage(filename, subfolder, folderType) {
    const params = new URLSearchParams({ filename, subfolder, type: folderType });
    const response = await fetch(`${COMFY_UI_IMAGE_MODEL_API_URL}/view?${params}`);
    return response.arrayBuffer(); // Use arrayBuffer for binary data
}

async function getHistory(promptId) {
    const response = await fetch(`${COMFY_UI_IMAGE_MODEL_API_URL}/history/${promptId}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    });
    return await response.json();
}

function calculatePeriodsIncreaseOverTime(periods = '') {
    // start with 1 period, then two, then three, and go back to one
    let periodsIncreaseOverTime = periods + '.';
    if (periodsIncreaseOverTime.length > 3) {
        periodsIncreaseOverTime = '.';
    }
    return periodsIncreaseOverTime;

}

async function generateImageWithTracking(prompt, client) {
    try {
        return new Promise((resolve, reject) => {
            const websocket = new WebSocket(`${COMFY_UI_IMAGE_MODEL_WEBSOCKET_URL}/ws?clientId=${clientId}`);
            let promptId = null;
            let isResolved = false;
            let executionStarted = false;
            let currentNode = null;
            let progressDots = '';

            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    websocket.close();
                    console.error('⏱️ Image generation timeout after 60 seconds');
                    reject(new Error('Image generation timeout'));
                }
            }, 60000);

            const cleanup = () => {
                clearTimeout(timeout);
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.close();
                }
            };

            websocket.onopen = async () => {
                try {
                    console.log('🔌 WebSocket connected, submitting prompt...');
                    const response = await postPrompt(prompt);
                    promptId = response.prompt_id;

                    if (!promptId) {
                        cleanup();
                        reject(new Error('No prompt ID received'));
                        return;
                    }

                    console.log(`📝 Prompt submitted with ID: ${promptId}`);
                } catch (innerError) {
                    cleanup();
                    reject(innerError);
                }
            };

            websocket.onmessage = async (event) => {
                if (isResolved) return;

                try {
                    const message = JSON.parse(event.data);

                    // Track execution start
                    if (message.type === 'execution_start' && message.data.nodes[13].prompt_id === promptId) {
                        executionStarted = true;
                        console.log(`\n🚀 Execution started for prompt ${promptId}`);
                    }

                    // Track cached nodes
                    if (message.type === 'execution_cached' && message.data.nodes[13].prompt_id === promptId) {
                        const cachedNodes = message.data.nodes || [];
                        if (cachedNodes.length > 0) {
                            console.log(`⚡ Using cached results for nodes: ${cachedNodes.join(', ')}`);
                        }
                    }
                    // Track currently executing node
                    if (message.type === 'executing') {
                        if (message.data.prompt_id === promptId) {
                            if (message.data.node) {
                                currentNode = message.data.node;
                                console.log(`\n📦 Executing node: ${currentNode}`);
                            }
                        }

                        // Check for completion (must match exact conditions from original)
                        if (message.data.node === null && message.data.prompt_id === promptId) {
                            console.log(`\n✅ Execution completed for prompt ${promptId}`);
                            isResolved = true;
                            cleanup();

                            const history = await getHistory(promptId);
                            const historyPromptId = history[promptId];

                            if (!historyPromptId || !historyPromptId.outputs) {
                                reject(new Error('No outputs in history'));
                                return;
                            }

                            const outputImages = {};

                            for (const node_id in historyPromptId.outputs) {
                                const nodeOutput = historyPromptId.outputs[node_id];
                                if ('images' in nodeOutput) {
                                    const imagesOutput = [];
                                    for (const image of nodeOutput.images) {
                                        const imageBuffer = await getImage(image.filename, image.subfolder, image.type);
                                        const base64Image = Buffer.from(imageBuffer).toString('base64');
                                        imagesOutput.push(base64Image);
                                    }
                                    outputImages[node_id] = imagesOutput;
                                }
                            }

                            resolve(outputImages);
                        }
                    }
                    // Track progress updates
                    if (message.type === 'progress_state') {
                        const { value, max } = message.data.nodes[13];
                        const percentage = Math.round((value / max) * 100);
                        progressDots = calculatePeriodsIncreaseOverTime(progressDots);

                        LightWrapper.cycleColor(config.PRIMARY_LIGHT_ID, 'rainbow');

                        // Clear the line and show progress
                        // console.log('\x1b[2K'); // Clear the entire line
                        console.log(`   Progress: [${generateProgressBar(percentage)}] ${percentage}% (${value}/${max}) ${progressDots}`);
                        // client.user.setActivity(`${generateProgressBar(percentage)}`, { type: 4 });
                        // update activity once every 20%
                        const clockEmojis = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'];
                        if (percentage === 100) {
                            client.user.setActivity(`Don't tag me...`, { type: 4 });
                        } else if (percentage % 10 === 0) {
                            const clockIndex = Math.floor(percentage / 10) % clockEmojis.length;
                            client.user.setActivity(`${clockEmojis[clockIndex]}🖼️: ${generateProgressBar(percentage)} ${percentage}%`, { type: 4 });
                        }
                        // process.stdout.write(`\r   Progress: [${generateProgressBar(percentage)}] ${percentage}% (${value}/${max}) ${progressDots}`);

                        if (value === max) {
                            console.log(''); // New line after completion
                        }
                    }

                    // Track completed nodes
                    if (message.type === 'executed' && message.data.nodes[13].prompt_id === promptId) {
                        if (message.data.nodes[13].node_id) {
                            console.log(`   ✔️  Node ${message.data.nodes[13].node_id} completed`);
                        }
                    }

                    // Track status updates
                    if (message.type === 'status') {
                        const { exec_info } = message.data.nodes[13].status || {};
                        if (exec_info && exec_info.queue_remaining) {
                            if (debugging) {
                                console.log(`📊 Queue status - Remaining: ${exec_info.queue_remaining}`);
                            }
                        }
                    }

                } catch (error) {
                    if (debugging) {
                        console.error('Error processing message:', error);
                    }
                }
            };

            websocket.onerror = (error) => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    console.error('❌ WebSocket error:', error);
                    reject(new Error('WebSocket error'));
                }
            };

            websocket.onclose = () => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    reject(new Error('WebSocket closed unexpectedly'));
                }
            };
        });
    } catch (error) {
        console.error('Error generating image:', error);
        throw error;
    }
}


async function generateImage(prompt) {
    try {
        return new Promise((resolve, reject) => {
            const websocket = new WebSocket(`${COMFY_UI_IMAGE_MODEL_WEBSOCKET_URL}/ws?clientId=${clientId}`);
            let promptId = null;
            let isResolved = false;

            // Add timeout for the entire operation
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    websocket.close();
                    if (debugging) {
                        console.error('Image generation timeout after 60 seconds');
                    }
                    reject(new Error('Image generation timeout'));
                }
            }, 60000); // 60 second timeout

            // Cleanup function
            const cleanup = () => {
                clearTimeout(timeout);
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.close();
                }
            };

            websocket.onopen = async () => {
                try {
                    const response = await postPrompt(prompt);
                    promptId = response.prompt_id;

                    if (!promptId) {
                        cleanup();
                        reject(new Error('No prompt ID received'));
                        return;
                    }
                } catch (innerError) {
                    cleanup();
                    reject(innerError);
                }
            };

            websocket.onmessage = async (event) => {
                if (isResolved) return;

                try {
                    const message = JSON.parse(event.data);

                    // Log progress messages if debugging
                    if (debugging && message.type === 'progress') {
                        console.log(`Progress: ${message.data.value}/${message.data.max}`);
                    }

                    if (message.type === 'executing' && message.data.node === null && message.data.prompt_id === promptId) {
                        isResolved = true;
                        cleanup();

                        const history = await getHistory(promptId);
                        const historyPromptId = history[promptId];

                        if (!historyPromptId || !historyPromptId.outputs) {
                            reject(new Error('No outputs in history'));
                            return;
                        }

                        const outputImages = {};

                        for (const node_id in historyPromptId.outputs) {
                            const nodeOutput = historyPromptId.outputs[node_id];
                            if ('images' in nodeOutput) {
                                const imagesOutput = [];
                                for (const image of nodeOutput.images) {
                                    const imageBuffer = await getImage(image.filename, image.subfolder, image.type);
                                    const base64Image = Buffer.from(imageBuffer).toString('base64');
                                    imagesOutput.push(base64Image);
                                }
                                outputImages[node_id] = imagesOutput;
                            }
                        }

                        resolve(outputImages);
                    }
                } catch (error) {
                    if (debugging) {
                        console.error('Error processing message:', error);
                    }
                }
            };

            websocket.onerror = (error) => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    if (debugging) {
                        console.error('WebSocket error:', error);
                    }
                    reject(new Error('WebSocket error'));
                }
            };

            websocket.onclose = () => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    reject(new Error('WebSocket closed unexpectedly'));
                }
            };
        });
    } catch (error) {
        if (debugging) {
            console.error('Error generating image:', error);
        }
        throw error;
    }
}

async function checkWebsocketStatus2() {
    try {
        return new Promise((resolve, reject) => {
            const websocket = new WebSocket(`${COMFY_UI_IMAGE_MODEL_WEBSOCKET_URL}/ws?clientId=${clientId}`);
            websocket.onopen = () => {
                websocket.close();
                resolve();
            };
            websocket.onerror = (error) => {
                if (debugging) {
                    console.error('⚠️ ComfyUI Is Down: Cannot Generate Image', error);
                }
                reject();
            };
        })
    } catch (error) {
        if (debugging) {
            console.error('⚠️ ComfyUI Is Down: Cannot Generate Image', error);
        }
        throw error;
    }
}

const sd3Prompt = {
    "6": {
        "inputs": {
            "text": "donald trump transforming into a car, transformers",
            "clip": [
                "11",
                0
            ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
            "title": "CLIP Text Encode (Prompt)"
        }
    },
    "11": {
        "inputs": {
            "clip_name1": "clip_g.safetensors",
            "clip_name2": "clip_l.safetensors",
            "clip_name3": "t5xxl_fp8_e4m3fn.safetensors"
        },
        "class_type": "TripleCLIPLoader",
        "_meta": {
            "title": "TripleCLIPLoader"
        }
    },
    "13": {
        "inputs": {
            "shift": 3,
            "model": [
                "252",
                0
            ]
        },
        "class_type": "ModelSamplingSD3",
        "_meta": {
            "title": "ModelSamplingSD3"
        }
    },
    "67": {
        "inputs": {
            "conditioning": [
                "71",
                0
            ]
        },
        "class_type": "ConditioningZeroOut",
        "_meta": {
            "title": "ConditioningZeroOut"
        }
    },
    "68": {
        "inputs": {
            "start": 0.1,
            "end": 1,
            "conditioning": [
                "67",
                0
            ]
        },
        "class_type": "ConditioningSetTimestepRange",
        "_meta": {
            "title": "ConditioningSetTimestepRange"
        }
    },
    "69": {
        "inputs": {
            "conditioning_1": [
                "68",
                0
            ],
            "conditioning_2": [
                "70",
                0
            ]
        },
        "class_type": "ConditioningCombine",
        "_meta": {
            "title": "Conditioning (Combine)"
        }
    },
    "70": {
        "inputs": {
            "start": 0,
            "end": 0.1,
            "conditioning": [
                "71",
                0
            ]
        },
        "class_type": "ConditioningSetTimestepRange",
        "_meta": {
            "title": "ConditioningSetTimestepRange"
        }
    },
    "71": {
        "inputs": {
            "text": "bad quality, poor quality, doll, disfigured, jpg, toy, bad anatomy, missing limbs, missing fingers, child, kid, anime",
            "clip": [
                "11",
                0
            ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
            "title": "CLIP Text Encode (Negative Prompt)"
        }
    },
    "135": {
        "inputs": {
            "width": 1080,
            "height": 1080,
            "batch_size": 1
        },
        "class_type": "EmptySD3LatentImage",
        "_meta": {
            "title": "EmptySD3LatentImage"
        }
    },
    "231": {
        "inputs": {
            "samples": [
                "271",
                0
            ],
            "vae": [
                "252",
                2
            ]
        },
        "class_type": "VAEDecode",
        "_meta": {
            "title": "VAE Decode"
        }
    },
    "233": {
        "inputs": {
            "images": [
                "231",
                0
            ]
        },
        "class_type": "PreviewImage",
        "_meta": {
            "title": "Preview Image"
        }
    },
    "252": {
        "inputs": {
            "ckpt_name": "sd3_medium.safetensors"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": {
            "title": "Load Checkpoint"
        }
    },
    "271": {
        "inputs": {
            "seed": 893434258339097,
            "steps": 40,
            "cfg": 4.5,
            "sampler_name": "dpmpp_2m",
            "scheduler": "sgm_uniform",
            "denoise": 1,
            "model": [
                "13",
                0
            ],
            "positive": [
                "6",
                0
            ],
            "negative": [
                "69",
                0
            ],
            "latent_image": [
                "135",
                0
            ]
        },
        "class_type": "KSampler",
        "_meta": {
            "title": "KSampler"
        }
    },
    "273": {
        "inputs": {
            "filename_prefix": "ComfyUI",
            "mode": "lossy",
            "compression": 90,
            "images": [
                "231",
                0
            ]
        },
        "class_type": "Save_as_webp",
        "_meta": {
            "title": "Save_as_webp"
        }
    }
}

const fluxPrompt = {
    "5": {
        "inputs": {
            // "width": 1024,
            // "height": 728,
            "width": 1024,
            "height": 1024,
            // "width": 512,
            // "height": 512,
            "batch_size": 1
        },
        "class_type": "EmptyLatentImage",
        "_meta": {
            "title": "Empty Latent Image"
        }
    },
    "6": {
        "inputs": {
            "text": "goku and vegeta kissing, making out, hugging, embrace",
            "clip": [
                "11",
                0
            ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
            "title": "CLIP Text Encode (Prompt)"
        }
    },
    "8": {
        "inputs": {
            "samples": [
                "13",
                0
            ],
            "vae": [
                "10",
                0
            ]
        },
        "class_type": "VAEDecode",
        "_meta": {
            "title": "VAE Decode"
        }
    },
    "9": {
        "inputs": {
            "filename_prefix": "ComfyUI",
            "images": [
                "8",
                0
            ]
        },
        "class_type": "SaveImage",
        "_meta": {
            "title": "Save Image"
        }
    },
    "10": {
        "inputs": {
            "vae_name": "ae.sft"
        },
        "class_type": "VAELoader",
        "_meta": {
            "title": "Load VAE"
        }
    },
    "11": {
        "inputs": {
            "clip_name1": "t5xxl_fp16.safetensors",
            "clip_name2": "clip_l.safetensors",
            "type": "flux"
        },
        "class_type": "DualCLIPLoader",
        "_meta": {
            "title": "DualCLIPLoader"
        }
    },
    "12": {
        "inputs": {
            "unet_name": "flux1-dev.sft",
            "weight_dtype": "fp8_e4m3fn"
        },
        "class_type": "UNETLoader",
        "_meta": {
            "title": "Load Diffusion Model"
        }
    },
    "13": {
        "inputs": {
            "noise": [
                "25",
                0
            ],
            "guider": [
                "22",
                0
            ],
            "sampler": [
                "16",
                0
            ],
            "sigmas": [
                "17",
                0
            ],
            "latent_image": [
                "5",
                0
            ]
        },
        "class_type": "SamplerCustomAdvanced",
        "_meta": {
            "title": "SamplerCustomAdvanced"
        }
    },
    "16": {
        "inputs": {
            "sampler_name": "euler"
        },
        "class_type": "KSamplerSelect",
        "_meta": {
            "title": "KSamplerSelect"
        }
    },
    "17": {
        "inputs": {
            "scheduler": "simple",
            "steps": 30,
            "denoise": 1,
            "model": [
                "12",
                0
            ]
        },
        "class_type": "BasicScheduler",
        "_meta": {
            "title": "BasicScheduler"
        }
    },
    "22": {
        "inputs": {
            "model": [
                "12",
                0
            ],
            "conditioning": [
                "6",
                0
            ]
        },
        "class_type": "BasicGuider",
        "_meta": {
            "title": "BasicGuider"
        }
    },
    "25": {
        "inputs": {
            "noise_seed": 375947136610401
        },
        "class_type": "RandomNoise",
        "_meta": {
            "title": "RandomNoise"
        }
    }
}

const fluxPromptImageToImage = {
    "6": {
        "inputs": {
            "text": "a crying man looking directly at the camera, in the style renaissance oil painting, 17th century traditional art, oil painting strokes, medieval knight wearing combat armour, battle scars and flaming eyes, depressed, sad, tears, water",
            "clip": [
                "11",
                0
            ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
            "title": "CLIP Text Encode (Prompt)"
        }
    },
    "8": {
        "inputs": {
            "samples": [
                "13",
                0
            ],
            "vae": [
                "10",
                0
            ]
        },
        "class_type": "VAEDecode",
        "_meta": {
            "title": "VAE Decode"
        }
    },
    "9": {
        "inputs": {
            "filename_prefix": "ComfyUI",
            "images": [
                "8",
                0
            ]
        },
        "class_type": "SaveImage",
        "_meta": {
            "title": "Save Image"
        }
    },
    "10": {
        "inputs": {
            "vae_name": "ae.sft"
        },
        "class_type": "VAELoader",
        "_meta": {
            "title": "Load VAE"
        }
    },
    "11": {
        "inputs": {
            "clip_name1": "t5xxl_fp16.safetensors",
            "clip_name2": "clip_l.safetensors",
            "type": "flux"
        },
        "class_type": "DualCLIPLoader",
        "_meta": {
            "title": "DualCLIPLoader"
        }
    },
    "12": {
        "inputs": {
            "unet_name": "flux1-dev.sft",
            "weight_dtype": "fp8_e4m3fn"
        },
        "class_type": "UNETLoader",
        "_meta": {
            "title": "Load Diffusion Model"
        }
    },
    "13": {
        "inputs": {
            "noise": [
                "25",
                0
            ],
            "guider": [
                "22",
                0
            ],
            "sampler": [
                "16",
                0
            ],
            "sigmas": [
                "17",
                0
            ],
            "latent_image": [
                "30",
                0
            ]
        },
        "class_type": "SamplerCustomAdvanced",
        "_meta": {
            "title": "SamplerCustomAdvanced"
        }
    },
    "16": {
        "inputs": {
            "sampler_name": "euler"
        },
        "class_type": "KSamplerSelect",
        "_meta": {
            "title": "KSamplerSelect"
        }
    },
    "17": {
        "inputs": {
            "scheduler": "simple",
            "steps": 28,
            "denoise": 0.8,
            "model": [
                "12",
                0
            ]
        },
        "class_type": "BasicScheduler",
        "_meta": {
            "title": "BasicScheduler"
        }
    },
    "22": {
        "inputs": {
            "model": [
                "12",
                0
            ],
            "conditioning": [
                "6",
                0
            ]
        },
        "class_type": "BasicGuider",
        "_meta": {
            "title": "BasicGuider"
        }
    },
    "25": {
        "inputs": {
            "noise_seed": 686420379242754
        },
        "class_type": "RandomNoise",
        "_meta": {
            "title": "RandomNoise"
        }
    },
    "26": {
        "inputs": {
            "image": "ReviewDexter.jpg",
            "upload": "image"
        },
        "class_type": "LoadImage",
        "_meta": {
            "title": "Load Image"
        }
    },
    "29": {
        "inputs": {
            "upscale_method": "lanczos",
            "megapixels": 1.05,
            "image": [
                "26",
                0
            ]
        },
        "class_type": "ImageScaleToTotalPixels",
        "_meta": {
            "title": "ImageScaleToTotalPixels"
        }
    },
    "30": {
        "inputs": {
            "pixels": [
                "29",
                0
            ],
            "vae": [
                "10",
                0
            ]
        },
        "class_type": "VAEEncode",
        "_meta": {
            "title": "VAE Encode"
        }
    }
}

// const prompt = {
//   "3": {
//     "inputs": {
//       "seed": 687520558485300,
//       "steps": 25,
//       "cfg": 4,
//       "sampler_name": "euler_ancestral",
//       "scheduler": "simple",
//       "denoise": 0.9,
//       "model": [
//         "30",
//         0
//       ],
//       "positive": [
//         "6",
//         0
//       ],
//       "negative": [
//         "7",
//         0
//       ],
//       "latent_image": [
//         "34",
//         0
//       ]
//     },
//     "class_type": "KSampler",
//     "_meta": {
//       "title": "KSampler"
//     }
//   },
//   "6": {
//     "inputs": {
//       "text": "a beautiful detailed image of an evil ghost wolf disguised as a ninja in the midst of Duskwood, its ethereal fur blending seamlessly with the shadows of the dark, enchanted forest. Equipped with ancient, ghostly ninja weaponry and glowing red eyes that pierce through the darkness, the wolf moves with supernatural agility and stealth. Around it, the mist of the night swirls, adding an air of mystique and danger. The scenery captures the ghost ninja wolf as it prepares to strike, embodying both the silent deadliness of a skilled assassin and the menacing aura of an otherworldly predator, under natural lighting, photography.",
//       "clip": [
//         "37",
//         0
//       ]
//     },
//     "class_type": "CLIPTextEncode",
//     "_meta": {
//       "title": "CLIP Text Encode (Prompt)"
//     }
//   },
//   "7": {
//     "inputs": {
//       "text": "watermark, signature",
//       "clip": [
//         "37",
//         0
//       ]
//     },
//     "class_type": "CLIPTextEncode",
//     "_meta": {
//       "title": "CLIP Text Encode (Prompt)"
//     }
//   },
//   "8": {
//     "inputs": {
//       "samples": [
//         "33",
//         0
//       ],
//       "vae": [
//         "29",
//         0
//       ]
//     },
//     "class_type": "VAEDecode",
//     "_meta": {
//       "title": "VAE Decode"
//     }
//   },
//   "29": {
//     "inputs": {
//       "vae_name": "stage_a.safetensors"
//     },
//     "class_type": "VAELoader",
//     "_meta": {
//       "title": "Load VAE"
//     }
//   },
//   "30": {
//     "inputs": {
//       "unet_name": "stage_c.safetensors"
//     },
//     "class_type": "UNETLoader",
//     "_meta": {
//       "title": "UNETLoader"
//     }
//   },
//   "32": {
//     "inputs": {
//       "unet_name": "stage_b.safetensors"
//     },
//     "class_type": "UNETLoader",
//     "_meta": {
//       "title": "UNETLoader"
//     }
//   },
//   "33": {
//     "inputs": {
//       "seed": 294817137222856,
//       "steps": 10,
//       "cfg": 1.4,
//       "sampler_name": "dpmpp_sde",
//       "scheduler": "sgm_uniform",
//       "denoise": 1,
//       "model": [
//         "32",
//         0
//       ],
//       "positive": [
//         "36",
//         0
//       ],
//       "negative": [
//         "40",
//         0
//       ],
//       "latent_image": [
//         "34",
//         1
//       ]
//     },
//     "class_type": "KSampler",
//     "_meta": {
//       "title": "KSampler"
//     }
//   },
//   "34": {
//     "inputs": {
//       "width": 1280,
//       "height": 1024,
//       "compression": 38,
//       "batch_size": 1
//     },
//     "class_type": "StableCascade_EmptyLatentImage",
//     "_meta": {
//       "title": "StableCascade_EmptyLatentImage"
//     }
//   },
//   "36": {
//     "inputs": {
//       "conditioning": [
//         "40",
//         0
//       ],
//       "stage_c": [
//         "3",
//         0
//       ]
//     },
//     "class_type": "StableCascade_StageB_Conditioning",
//     "_meta": {
//       "title": "StableCascade_StageB_Conditioning"
//     }
//   },
//   "37": {
//     "inputs": {
//       "clip_name": "model.safetensors",
//       "type": "stable_cascade"
//     },
//     "class_type": "CLIPLoader",
//     "_meta": {
//       "title": "Load CLIP"
//     }
//   },
//   "40": {
//     "inputs": {
//       "conditioning": [
//         "6",
//         0
//       ]
//     },
//     "class_type": "ConditioningZeroOut",
//     "_meta": {
//       "title": "ConditioningZeroOut"
//     }
//   },
//   "43": {
//     "inputs": {
//       "filename_prefix": "ComfyUI",
//       "mode": "lossy",
//       "compression": 90,
//       "images": [
//         "8",
//         0
//       ]
//     },
//     "class_type": "Save_as_webp",
//     "_meta": {
//       "title": "Save_as_webp"
//     }
//   }
// }


function generateRandomRange(min, max) {
    const random = Math.random() * (max - min) + min;
    // Multiply by 100, round, then divide by 100
    return Math.round(random * 100) / 100;
}


function generateTextToImagePrompt(text) {
    const fullPrompt = fluxPrompt
    if (text) {
        // fullPrompt["3"]["inputs"]["seed"] = Math.floor(Math.random() * 1000000000000000);
        // fullPrompt["33"]["inputs"]["seed"] = Math.floor(Math.random() * 1000000000000000);
        // fullPrompt["271"]["inputs"]["seed"] = Math.floor(Math.random() * 1000000000000000);
        fullPrompt["25"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 1000000000000000);
        fullPrompt["6"]["inputs"]["text"] = text;
    }
    return fullPrompt
}
function generateImageToImagePrompt(text, imagePath, denoisingStrength) {
    consoleLog('<');
    const fullPrompt = fluxPromptImageToImage
    if (text) {
        // Anything under 0.7 is too low and doesn't change the image that much
        // Anything over 0.9 is too high and the image is too different
        const randomRange = generateRandomRange(0.78, 0.88);
        fullPrompt["17"]["inputs"]["denoise"] = randomRange;
        fullPrompt["17"]["inputs"]["steps"] = 40;
        fullPrompt["25"]["inputs"]["noise_seed"] = denoisingStrength || Math.floor(Math.random() * 1000000000000000);
        fullPrompt["26"]["inputs"]["image"] = imagePath;
        fullPrompt["6"]["inputs"]["text"] = text;
        consoleLog('=', `DENOISE: ${randomRange}`);
        consoleLog('=', `TEXT: ${text}`);
    }
    consoleLog('>');
    return fullPrompt
}

const ComfyUIWrapper = {
    async generateComfyUIImage(text, client) {
        try {
            // Check if ComfyUI is available before attempting generation
            await ComfyUIWrapper.checkComfyUIWebsocketStatus();

            const prompt = generateTextToImagePrompt(text);
            const images = await generateImageWithTracking(prompt, client);

            if (!images || !images[9] || !images[9][0]) {
                throw new Error('No image generated');
            }

            return images[9][0];
        } catch (error) {
            console.error('⚠️ ComfyUI Workflow Error: Cannot Return Image', error.message);
            throw error; // Re-throw to let caller handle it
        }
    },
    async generateComfyUIImageToImage(text, imageUrl, denoisingStrength) {
        try {
            // Check if ComfyUI is available before attempting generation
            await ComfyUIWrapper.checkComfyUIWebsocketStatus();

            const imagePath = await downloadImage(imageUrl, path.join(import.meta.dirname, 'downloadedImage.jpg'));
            const prompt = generateImageToImagePrompt(text, imagePath, denoisingStrength);
            const images = await generateImage(prompt);

            if (!images || !images[9] || !images[9][0]) {
                throw new Error('No image generated');
            }

            return images[9][0];
        } catch (error) {
            console.error('⚠️ ComfyUI Workflow Error: Cannot Return Image', error.message);
            throw error; // Re-throw to let caller handle it
        }
    },
    async checkComfyUIWebsocketStatus() {
        const functionName = 'checkComfyUIWebsocketStatus';
        return new Promise((resolve, reject) => {
            const websocket = new WebSocket(`${COMFY_UI_IMAGE_MODEL_WEBSOCKET_URL}/ws?clientId=${clientId}`);

            // Add timeout
            const timeout = setTimeout(() => {
                websocket.close();
                console.error(...LogFormatter.comfyUITimedOut(functionName));
                reject(new Error('WebSocket connection timeout'));
            }, 10000);

            websocket.onopen = () => {
                clearTimeout(timeout);
                websocket.close();
                console.log(...LogFormatter.comfyUIUp(functionName));
                resolve();
            };

            websocket.onerror = (error) => {
                clearTimeout(timeout);
                console.warn(...LogFormatter.comfyUIDown(functionName));
                reject();
            };
        })
    }
};

export default ComfyUIWrapper;