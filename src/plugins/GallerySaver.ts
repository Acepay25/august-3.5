/**
 * GallerySaver - Custom Capacitor plugin for saving images to Android Gallery
 */

import { registerPlugin } from '@capacitor/core';

export interface GallerySaverPlugin {
    saveImage(options: { base64: string; filename?: string }): Promise<{
        success: boolean;
        uri: string;
        message: string;
    }>;
}

const GallerySaver = registerPlugin<GallerySaverPlugin>('GallerySaver');

export default GallerySaver;
