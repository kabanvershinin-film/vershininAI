/**
 * @typedef {'text'|'image'|'video'|'audio'|'workflow'|'agent'|'app'|'unknown'} GenerationMediaType
 * @typedef {'chat'|'vision'|'responses'|'analysis'|'t2i'|'i2i'|'t2v'|'i2v'|'v2v'|'lipsync'|'music'|'tts'|'workflow_run'|'agent_chat'} GenerationOperation
 * @typedef {'active'|'stale'|'manually_disabled'|'tombstoned'} ModelLifecycleState
 */

export const MEDIA_TYPES = Object.freeze(['text', 'image', 'video', 'audio', 'workflow', 'agent', 'app', 'unknown']);

export const OPERATION_MEDIA_TYPE = Object.freeze({
    chat: 'text',
    vision: 'text',
    responses: 'text',
    analysis: 'text',
    t2i: 'image',
    i2i: 'image',
    t2v: 'video',
    i2v: 'video',
    v2v: 'video',
    lipsync: 'video',
    music: 'audio',
    tts: 'audio',
    workflow_run: 'workflow',
    agent_chat: 'agent',
});

export function featureKey(mediaType, operation) {
    return `${mediaType}:${operation}`;
}

export function inferMediaTypeFromOperation(operation) {
    return OPERATION_MEDIA_TYPE[operation] || 'unknown';
}
