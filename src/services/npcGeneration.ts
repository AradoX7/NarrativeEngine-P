import type { EndpointConfig, ProviderConfig, ChatMessage, NPCEntry } from '../types';
import type { OpenAIMessage } from './llmService';
import { sendMessage } from './llmService';
import { extractJson } from './payloadBuilder';
import { uid } from '../utils/uid';

const RETRY_SUFFIX = '\n\nIMPORTANT: Your previous response was not valid JSON. Respond with ONLY valid JSON. No markdown fences, no comments, no trailing commas, no extra text before or after the JSON.';

async function sendMessageAndParseJson(
    provider: EndpointConfig | ProviderConfig,
    messages: OpenAIMessage[],
    contextLabel: string
): Promise<{ parsed: any; rawStr: string }> {
    let fullJsonStr = '';

    await sendMessage(
        provider,
        messages,
        (chunk) => { fullJsonStr = chunk; },
        () => { },
        (err) => console.error(`[${contextLabel}] Stream error:`, err)
    );

    if (!fullJsonStr) throw new Error(`[${contextLabel}] Empty response from LLM`);

    const cleanStr = extractJson(fullJsonStr);

    try {
        return { parsed: JSON.parse(cleanStr), rawStr: cleanStr };
    } catch (firstErr) {
        console.warn(`[${contextLabel}] First parse failed, retrying with stricter prompt...`, firstErr);
        console.warn(`[${contextLabel}] Raw JSON was:`, cleanStr);

        const retryMessages: OpenAIMessage[] = [
            ...messages,
            { role: 'assistant', content: fullJsonStr },
            { role: 'user', content: RETRY_SUFFIX }
        ];

        let retryStr = '';
        await sendMessage(
            provider,
            retryMessages,
            (chunk) => { retryStr = chunk; },
            () => { },
            (err) => console.error(`[${contextLabel}] Retry stream error:`, err)
        );

        if (!retryStr) throw new Error(`[${contextLabel}] Empty retry response`);

        const retryClean = extractJson(retryStr);
        try {
            return { parsed: JSON.parse(retryClean), rawStr: retryClean };
        } catch (retryErr) {
            console.error(`[${contextLabel}] Retry parse also failed:`, retryErr);
            console.error(`[${contextLabel}] Retry raw JSON:`, retryClean);
            throw retryErr;
        }
    }
}

export async function generateNPCProfile(
    provider: EndpointConfig | ProviderConfig,
    history: ChatMessage[],
    npcName: string,
    addNPCToStore: (npc: NPCEntry) => void
): Promise<void> {
    console.log(`[NPC Generator] Initiating background profile generation for: ${npcName}`);

    const recentHistory = history.slice(-15).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    const systemPrompt = `You are a background GM assistant running silently.
The game mentioned a new character named "${npcName}".
Your job is to generate a profile for this character based on the recent chat history.
If the character is barely mentioned, invent a plausible, tropes-appropriate profile that fits the current scene context.

RESPOND ONLY WITH VALID JSON. NO MARKDOWN FORMATTING. NO EXPLANATIONS.
The JSON must perfectly match this structure:
{
  "name": "String (The primary name)",
  "aliases": "String (Comma separated aliases or titles)",
  "status": "String (Alive, Deceased, Missing, or Unknown)",
  "faction": "String (The faction, group, or origin this NPC belongs to)",
  "storyRelevance": "String (Why this NPC matters to the current story)",
  "visualProfile": {
    "race": "String (e.g. Human, Elf)",
    "gender": "String",
    "ageRange": "String",
    "build": "String",
    "symmetry": "String (e.g. symmetrical features for handsome, rugged, asymmetrical/pockmarked for ugly)",
    "hairStyle": "String",
    "eyeColor": "String",
    "skinTone": "String",
    "gait": "String",
    "distinctMarks": "String",
    "clothing": "String"
  },
  "disposition": "String (current mood/attitude: Helpful, Hostile, Suspicious, etc)",
  "goals": "String (Core motive)",
  "voice": "String — describe HOW this NPC speaks: sentence length, vocabulary level, verbal quirks, catchphrases, accent notes. Be specific.",
  "personality": "String — core personality traits in plain language. What drives them? How do they treat others? What do they fear?",
  "exampleOutput": "String — one line of in-character dialogue that demonstrates their voice and personality. Include a brief action in brackets if needed.",
  "drives": {
    "coreWant": "String — one sentence: a deep character truth this NPC carries (NOT a goal). Example: 'to be seen as capable, not just loyal'",
    "sessionWant": "String — one sentence: what this NPC is working toward in the current arc. Example: 'convince the party to take the northern route'",
    "sceneWant": "String — one sentence: what this NPC wants from the immediate scene. Example: 'get the player to trust her enough to share information'"
  },
  "behavioralTriggers": [
    { "keyword": "String — a word or phrase that, when it appears in player input or narrative, activates this trigger", "shift": "String — a PHYSICAL or VERBAL behavioral shift (NOT an emotion). Good: 'crosses arms, answers in single syllables'. Bad: 'becomes angry'." }
  ],
  "hardBoundaries": ["String — something this NPC will never do. Example: 'will not betray her sister'"],
  "softBoundaries": ["String — something this NPC dislikes but may tolerate under pressure. Example: 'dislikes being excluded from plans'"]
}`;

    const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `RECENT CHAT HISTORY:\n${recentHistory}\n\nGenerate the JSON profile for "${npcName}".` }
    ];

    try {
        const { parsed } = await sendMessageAndParseJson(provider, messages, 'NPC Generator');

        const newEntry: NPCEntry = {
            id: uid(),
            name: parsed.name || npcName,
            aliases: parsed.aliases || '',
            status: parsed.status || 'Alive',
            faction: parsed.faction || 'Unknown',
            storyRelevance: parsed.storyRelevance || 'Unknown',
            appearance: '',
            visualProfile: parsed.visualProfile || {
                race: 'Unknown', gender: 'Unknown', ageRange: 'Unknown', build: 'Unknown', symmetry: 'Unknown', hairStyle: 'Unknown', eyeColor: 'Unknown', skinTone: 'Unknown', gait: 'Unknown', distinctMarks: 'None', clothing: 'Unknown', artStyle: 'Anime'
            },
            disposition: parsed.disposition || 'Neutral',
            goals: parsed.goals || 'Unknown',
            voice: parsed.voice || '',
            personality: parsed.personality || parsed.disposition || 'Unknown',
            exampleOutput: parsed.exampleOutput || '',
            affinity: 50,
            drives: parsed.drives ? {
                coreWant: parsed.drives.coreWant || '',
                sessionWant: parsed.drives.sessionWant || '',
                sceneWant: parsed.drives.sceneWant || '',
            } : undefined,
            behavioralTriggers: Array.isArray(parsed.behavioralTriggers)
                ? parsed.behavioralTriggers.filter((t: Record<string, unknown>) => t.keyword && t.shift).map((t: Record<string, unknown>) => ({ keyword: String(t.keyword), shift: String(t.shift) }))
                : undefined,
            hardBoundaries: Array.isArray(parsed.hardBoundaries)
                ? parsed.hardBoundaries.map(String).filter(Boolean)
                : undefined,
            softBoundaries: Array.isArray(parsed.softBoundaries)
                ? parsed.softBoundaries.map(String).filter(Boolean)
                : undefined,
        };

        addNPCToStore(newEntry);
        console.log(`[NPC Generator] Successfully generated and added profile for: ${newEntry.name}`);

    } catch (err) {
        console.error('[NPC Generator] Failed to generate NPC profile:', err);
    }
}

/**
 * Background auto-update for existing NPCs that were mentioned in the chat.
 * Asks the LLM if any relevant attributes have changed based on recent context.
 */
export async function updateExistingNPCs(
    provider: EndpointConfig | ProviderConfig,
    history: ChatMessage[],
    npcsToCheck: NPCEntry[],
    updateNPCStore: (id: string, updates: Partial<NPCEntry>) => void
) {
    if (!npcsToCheck.length) return;

    console.log(`[NPC Updater] Checking for attribute shifts on ${npcsToCheck.length} existing NPC(s)...`);

    const recentContext = history.slice(-5).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    const npcDatas = npcsToCheck.map(npc => {
        const vp = npc.visualProfile || { race: '', gender: '', ageRange: '', build: '', symmetry: '', hairStyle: '', eyeColor: '', skinTone: '', gait: '', distinctMarks: '', clothing: '' };
        const missingFields = Object.entries(vp)
            .filter(([key, val]) => key !== 'artStyle' && (!val || val === 'Unknown' || val === 'None'))
            .map(([key]) => key);

        let data = `[NPC: ${npc.name}]\n` +
            `Status: ${npc.status || 'Alive'}\n` +
            `Appearance: ${npc.appearance || 'Unknown'}\n` +
            `Disposition: ${npc.disposition || 'Unknown'}\n` +
            `Goals: ${npc.goals || 'Unknown'}\n` +
            `Affinity: ${npc.affinity ?? 50}/100\n` +
            `Personality: ${npc.personality || npc.disposition || 'Unknown'}\n` +
            `Voice: ${npc.voice || 'not defined'}\n` +
            `Faction: ${npc.faction || 'Unknown'}\n` +
            `Story Relevance: ${npc.storyRelevance || 'Unknown'}\n`;

        if (npc.drives) {
            data += `CoreWant: ${npc.drives.coreWant || 'Unknown'}\n` +
                `SessionWant: ${npc.drives.sessionWant || 'Unknown'}\n` +
                `SceneWant: ${npc.drives.sceneWant || 'Unknown'}\n`;
        } else {
            data += `Drives: NOT YET POPULATED\n`;
        }

        if (npc.behavioralTriggers && npc.behavioralTriggers.length > 0) {
            data += `Triggers: ${npc.behavioralTriggers.map(t => `"${t.keyword}" → ${t.shift}`).join('; ')}\n`;
        }

        if (missingFields.length > 0) {
            data += `NOTE: This NPC has missing or generic "visualProfile" fields: ${missingFields.join(', ')}. You MUST attempt to determine specific values for these based on their "Appearance" and recent context.\n`;
        }
        return data;
    }).join('\n\n');

    const prompt = `You are a background game state analyzer. Your job is to read the RECENT CONTEXT of an RPG session and determine if any of the provided NPCs have undergone a shift in their status, personality, goals, disposition, faction, or relevance.

[RECENT CONTEXT]
${recentContext}
[END CONTEXT]

[CURRENT NPC STATES]
${npcDatas}
[END STATES]

If NO changes occurred for ANY of these NPCs, respond EXACTLY with:
{"updates": []}

If ANY changes occurred, respond with a JSON object containing an "updates" array. Each update must include the basic "name" and ANY attributes that have fundamentally changed (status, disposition, goals, personality, voice, affinity, faction, storyRelevance, visualProfile, drives). DO NOT include attributes that stayed the same.
Valid statuses: Alive, Deceased, Missing, Unknown.
Note: "affinity" is a 0-100 scale of how much they like the player (0=Nemesis, 50=Neutral, 100=Ally). Update this if the player did something to gain or lose favor.
Do NOT change personality or voice unless the scene contains a genuinely transformative event for this character.

DRIVES UPDATE RULES:
- "drives" is an object with "coreWant", "sessionWant", and "sceneWant".
- "coreWant" is a deep character truth — almost never changes. Only update if a transformative event reshapes who this NPC is.
- "sessionWant" is their arc-level objective — update if the story has clearly moved to a new arc or their long-term situation shifted.
- "sceneWant" is their immediate scene-level goal — this changes OFTEN. Update whenever the scene context, NPC's situation, or conversation direction has shifted. Always include a new sceneWant if the old one is clearly resolved or irrelevant.
- If the NPC has "Drives: NOT YET POPULATED", you MUST provide ALL THREE drive fields (coreWant, sessionWant, sceneWant) plus at least one behavioralTrigger, one hardBoundary, and one softBoundary.
- Only include the "drives" field if at least one sub-field changed or needs to be populated.

Example of an NPC dying and getting angry:
{"updates": [{"name": "Captain Vorin", "changes": {"status": "Deceased", "personality": "consumed by rage in final moments, betrayed and broken", "storyRelevance": "His death sparked a rebellion"}}]}

Example of an NPC whose scene context shifted:
{"updates": [{"name": "Senna", "changes": {"drives": {"sceneWant": "convince the party to camp here tonight — she spotted tracks earlier and wants to investigate at dawn"}}}]}

Example of a legacy NPC getting drives for the first time:
{"updates": [{"name": "Aldric", "changes": {"drives": {"coreWant": "to prove his family's honor is worth more than their fallen name", "sessionWant": "secure an alliance with the player's group", "sceneWant": "get the player to agree to meet his lord"}, "behavioralTriggers": [{"keyword": "coward", "shift": "jaw tightens, speaks through clenched teeth, changes subject to his military record"}], "hardBoundaries": ["will not abandon a wounded ally"], "softBoundaries": ["resents being reminded of his family's disgrace"]}}]}

RESPOND ONLY WITH VALID JSON.`;

    const messages: OpenAIMessage[] = [{
        role: 'user',
        content: prompt
    }];

    try {
        const { parsed } = await sendMessageAndParseJson(provider, messages, 'NPC Updater');

        if (parsed.updates && Array.isArray(parsed.updates)) {
            for (const update of parsed.updates) {
                if (!update.name || !update.changes) continue;

                const targetNpc = npcsToCheck.find(n =>
                    n.name.toLowerCase() === update.name.toLowerCase() ||
                    (n.aliases && n.aliases.toLowerCase().includes(update.name.toLowerCase()))
                );

                if (targetNpc) {
                    const changes = { ...update.changes };

                    const hasPersonalityChange = changes.personality !== undefined || changes.voice !== undefined;
                    const hasAffinityChange = changes.affinity !== undefined;

                    if (hasPersonalityChange || hasAffinityChange) {
                        changes.previousSnapshot = {
                            personality: targetNpc.personality || targetNpc.disposition || '',
                            voice: targetNpc.voice || '',
                            affinity: targetNpc.affinity,
                        };
                        changes.shiftTurnCount = 0;
                    } else if (targetNpc.shiftTurnCount !== undefined && targetNpc.shiftTurnCount < 3) {
                        changes.shiftTurnCount = (targetNpc.shiftTurnCount || 0) + 1;
                    }

                    if (changes.visualProfile && typeof changes.visualProfile === 'object') {
                        changes.visualProfile = {
                            ...targetNpc.visualProfile,
                            ...changes.visualProfile,
                            artStyle: targetNpc.visualProfile?.artStyle || 'Anime'
                        };
                    }

                    if (changes.drives && typeof changes.drives === 'object') {
                        const existingDrives = targetNpc.drives || { coreWant: '', sessionWant: '', sceneWant: '' };
                        changes.drives = {
                            coreWant: changes.drives.coreWant || existingDrives.coreWant,
                            sessionWant: changes.drives.sessionWant || existingDrives.sessionWant,
                            sceneWant: changes.drives.sceneWant || existingDrives.sceneWant,
                        };
                    }

                    if (Array.isArray(changes.behavioralTriggers)) {
                        changes.behavioralTriggers = changes.behavioralTriggers
                            .filter((t: Record<string, unknown>) => t.keyword && t.shift)
                            .map((t: Record<string, unknown>) => ({ keyword: String(t.keyword), shift: String(t.shift) }));
                    }

                    if (Array.isArray(changes.hardBoundaries)) {
                        changes.hardBoundaries = changes.hardBoundaries.map(String).filter(Boolean);
                    }

                    if (Array.isArray(changes.softBoundaries)) {
                        changes.softBoundaries = changes.softBoundaries.map(String).filter(Boolean);
                    }

                    updateNPCStore(targetNpc.id, changes);
                    console.log(`[NPC Updater] Applied changes to ${targetNpc.name}:`, changes);
                }
            }
        } else {
            console.log(`[NPC Updater] No updates required.`);
        }
    } catch (err) {
        console.error('[NPC Updater] Failed to parse generated JSON or fatal error:', err);
    }
}

export async function backfillNPCDrives(
    provider: EndpointConfig | ProviderConfig,
    history: ChatMessage[],
    npcsNeedingDrives: NPCEntry[],
    updateNPCStore: (id: string, updates: Partial<NPCEntry>) => void
): Promise<void> {
    if (!npcsNeedingDrives.length) return;

    console.log(`[NPC Drives Backfill] Populating drives for ${npcsNeedingDrives.length} legacy NPC(s)...`);

    const recentContext = history.slice(-10).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    for (const npc of npcsNeedingDrives) {
        const npcSummary = `Name: ${npc.name}\nPersonality: ${npc.personality || npc.disposition || 'Unknown'}\nVoice: ${npc.voice || 'Unknown'}\nGoals: ${npc.goals || 'Unknown'}\nFaction: ${npc.faction || 'Unknown'}\nAffinity: ${npc.affinity ?? 50}/100\nStory Relevance: ${npc.storyRelevance || 'Unknown'}`;

        const prompt = `You are a background GM assistant. An existing NPC in a TTRPG campaign needs their drives, behavioral triggers, and boundaries populated. Based on their profile and recent game context, generate these fields.

[NPC PROFILE]
${npcSummary}
[END PROFILE]

[RECENT GAME CONTEXT]
${recentContext}
[END CONTEXT]

RESPOND ONLY WITH VALID JSON. NO MARKDOWN FORMATTING. NO EXPLANATIONS.
{
  "coreWant": "String — one sentence: a deep character truth this NPC carries (NOT a goal). Example: 'to be seen as capable, not just loyal'",
  "sessionWant": "String — one sentence: what this NPC is working toward in the current arc based on context. If unclear, invent a plausible arc goal.",
  "sceneWant": "String — one sentence: what this NPC wants from the most recent scene. Base this on the recent context if possible.",
  "behavioralTriggers": [
    { "keyword": "String — a word/phrase that activates this trigger based on their personality", "shift": "String — PHYSICAL/VERBAL behavioral shift (NOT emotion). Good: 'crosses arms, single-syllable answers'. Bad: 'becomes angry'." }
  ],
  "hardBoundaries": ["String — something this NPC will never do"],
  "softBoundaries": ["String — something this NPC dislikes but may tolerate"]
}`;

        const messages: OpenAIMessage[] = [
            { role: 'user', content: prompt }
        ];

        try {
            const { parsed } = await sendMessageAndParseJson(provider, messages, `NPC Drives Backfill/${npc.name}`);

            const patch: Partial<NPCEntry> = {
                drives: {
                    coreWant: parsed.coreWant || `${npc.name} wants to prove their worth`,
                    sessionWant: parsed.sessionWant || `${npc.name} is looking for opportunity`,
                    sceneWant: parsed.sceneWant || `${npc.name} is observing the situation`,
                },
                behavioralTriggers: Array.isArray(parsed.behavioralTriggers)
                    ? parsed.behavioralTriggers.filter((t: Record<string, unknown>) => t.keyword && t.shift).map((t: Record<string, unknown>) => ({ keyword: String(t.keyword), shift: String(t.shift) }))
                    : [],
                hardBoundaries: Array.isArray(parsed.hardBoundaries)
                    ? parsed.hardBoundaries.map(String).filter(Boolean)
                    : [],
                softBoundaries: Array.isArray(parsed.softBoundaries)
                    ? parsed.softBoundaries.map(String).filter(Boolean)
                    : [],
            };

            updateNPCStore(npc.id, patch);
            console.log(`[NPC Drives Backfill] Populated drives for ${npc.name}:`, patch.drives);
        } catch (err) {
            console.error(`[NPC Drives Backfill] Failed for ${npc.name}:`, err);
        }
    }
}

// ============================================================================
// Image Generation API
// ============================================================================

export async function generateNPCPortrait(config: EndpointConfig, prompt: string): Promise<string> {
    if (!config.endpoint) {
        throw new Error('Image AI not configured');
    }

    const payload = {
        model: config.modelName || 'nano-banana',
        prompt,
        negative_prompt: "multiple people, group, crowd, split screen, twins, double, text, watermark, signature",
        size: '896x1152',
        response_format: 'url',
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    // Normalize: strip trailing slashes and any pre-existing /images/generations suffix,
    // then always append the correct path. Works for both base endpoints and full paths.
    const baseEndpoint = config.endpoint
        .replace(/\/+$/, '')                   // strip trailing slashes
        .replace(/\/images\/generations$/, ''); // strip suffix if already present
    const url = `${baseEndpoint}/images/generations`;

    try {
        console.log('[Image Engine] Sending payload:', payload);
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Failed to generate image: ${err}`);
        }

        const data = await res.json();

        // Match nano-gpt return format
        if (data.data && data.data[0] && data.data[0].url) {
            return data.data[0].url;
        }

        throw new Error('Unexpected output format from Image AI: ' + JSON.stringify(data));
    } catch (error) {
        console.error('[Image Engine] Error generating portrait:', error);
        throw error;
    }
}
