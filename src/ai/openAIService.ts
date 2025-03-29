import OpenAI from 'openai';
import {config} from '../config';
import {logger} from '../utils/logger';

const openai = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
});

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

interface AiResponse {
    title: string;
    hashtags: string[];
}

export async function generateNoteMetadata(content: string, imagesInBase64?: string[]): Promise<AiResponse> {
    const prompt = `Analyze the following content and generate a concise, filesystem-friendly title (max 10 words, avoid special characters like /\\:*?"<>|) and a list of relevant hashtags (e.g., ["#topic1", "#topic2"]).

Content:
"""
${content.substring(0, 5000)}
"""

Hashtags a.k.a categories should always be on English and start with a # symbol. If companies, products, or people are mentioned, they should be included as hashtags.
Title should be on the same language as the content and should be concise and descriptive.
Respond ONLY with a valid JSON object in the following format:
{"title": "Your Concise Title", "hashtags": ["#tag1", "#tag2", "#relevantHashtag"]}`;

    logger.debug(`Sending prompt to OpenAI: ${prompt.substring(0, 100)}...`);

    const openAiContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        {
            type: 'text',
            text: prompt,
        }
    ]

    if (imagesInBase64) {
        imagesInBase64.forEach((image) => {
            openAiContent.push({
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${image}`,
                    detail: 'low'
                }
            });
        })
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const completion = await openai.chat.completions.create({
                messages: [
                    {
                        role: 'user',
                        content: openAiContent
                    }
                ],
                model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo', // Allow model override via env
                temperature: 0.5, // Lower temperature for more deterministic results
                response_format: {type: "json_object"}, // Request JSON output if model supports it
            });

            const responseText = completion.choices[0]?.message?.content;
            if (!responseText) {
                throw new Error('OpenAI response text was empty.');
            }

            logger.debug(`Raw OpenAI response: ${responseText}`);

            // Parse the JSON response
            let parsedResponse: AiResponse;
            try {
                parsedResponse = JSON.parse(responseText);
            } catch (parseError) {
                logger.error(`Failed to parse OpenAI JSON response: ${responseText}`, parseError);
                // Attempt to extract JSON from potentially padded response (sometimes models add explanations)
                const jsonMatch = responseText.match(/{[\s\S]*}/);
                if (jsonMatch) {
                    try {
                        parsedResponse = JSON.parse(jsonMatch[0]);
                        logger.warn(`Successfully parsed JSON after extraction: ${jsonMatch[0]}`);
                    } catch (nestedParseError) {
                        throw new Error(`Failed to parse extracted JSON: ${jsonMatch[0]}`);
                    }
                } else {
                    throw new Error(`Response was not valid JSON: ${responseText}`);
                }
            }


            // Validate the parsed structure (basic check)
            if (typeof parsedResponse.title !== 'string' || !Array.isArray(parsedResponse.hashtags)) {
                throw new Error('Parsed OpenAI response did not match expected format.');
            }

            // Ensure hashtags start with #
            parsedResponse.hashtags = parsedResponse.hashtags
                .map(tag => typeof tag === 'string' ? (tag.startsWith('#') ? tag.trim() : `#${tag.trim()}`) : null)
                .filter(tag => tag !== null) as string[];

            logger.info(`Generated metadata - Title: "${parsedResponse.title}", Hashtags: ${parsedResponse.hashtags.join(', ')}`);
            return parsedResponse;

        } catch (error: any) {
            logger.warn(`OpenAI API call failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`, {error});
            if (attempt === MAX_RETRIES) {
                logger.error('OpenAI API call failed after multiple retries.');
                throw error; // Re-throw the last error
            }
            // Exponential backoff for retries
            await new Promise(resolve => setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)));
        }
    }

    // Should not be reachable if MAX_RETRIES > 0, but satisfies TypeScript
    throw new Error('OpenAI processing failed after all retries.');
}