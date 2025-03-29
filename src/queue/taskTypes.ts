export interface MediaInfo {
    fileId: string;
    fileName: string; // Original or derived filename
    mimeType?: string;
    type: 'photo' | 'video' | 'document';
}

export interface QueueTask {
    chatId: number;
    messageId: number;
    text?: string; // Text or caption
    media?: MediaInfo;
    forwardSourceLink?: string; // Link to original message if forwarded
    userId?: number;
    username?: string;
    messageDate: number; // Unix timestamp
}