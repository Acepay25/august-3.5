import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.august35.tradingapp',
    appName: 'August 3.5',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
        cleartext: false
    },
    android: {
        allowMixedContent: false
    }
};

export default config;
