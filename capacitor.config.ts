import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.august35.tradingapp',
    appName: 'August 3.5',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
        cleartext: true
    },
    android: {
        allowMixedContent: true
    }
};

export default config;
