import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.august35.tradingapp',
    appName: 'August Trading',
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
