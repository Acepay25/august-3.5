
// Mock Capacitor Filesystem manually for Node environment
const mockStorage: Record<string, string> = {};

const mockFilesystem = {
    writeFile: async (opts: any) => {
        console.log('[MockFS] Writing file:', opts.path);
        mockStorage[opts.path] = opts.data;
    },
    readFile: async (opts: any) => {
        console.log('[MockFS] Reading file:', opts.path);
        if (mockStorage[opts.path]) {
            return { data: mockStorage[opts.path] };
        }
        throw { message: 'File does not exist' };
    },
    Directory: { Data: 'DATA' },
    Encoding: { UTF8: 'utf8' }
};

// Intercept require calls to inject mock
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (path: string) {
    if (path === '@capacitor/filesystem') {
        return mockFilesystem;
    }
    return originalRequire.apply(this, arguments);
};

// Import dependencies
// We use require to ensure the mock is picked up
const GlobalLearningService = require('../services/GlobalLearningService').default;
// Import types for type checking (only used as values if needed, otherwise just for structure)

async function validatePersistence() {
    console.log('--- Starting GlobalLearningService Persistence Check ---');

    console.log('1. Initializing Service...');
    // We expect it to try loading and fail (empty storage), which is handled
    await GlobalLearningService.initialize();

    // Check initial state
    const initialCal = GlobalLearningService.getCalibration();
    // In our mocked env, initializeCalibration returns defaults.
    // We need to assume the service uses its internal logic correctly.
    console.log('Initial Calibration loaded (should be empty/default).');

    console.log('\n2. Updating Calibration (Simulating Trade)...');
    // Simulate a WIN on High confidence
    await GlobalLearningService.updateCalibration({
        timestamp: new Date().toISOString(),
        confidence: 'High',
        outcome: 'WIN',
        coin: 'TEST_COIN',
        pattern: 'TEST_PATTERN',
        timeframe: '4h',
        regime: 'trending'
    });

    const updatedCal = GlobalLearningService.getCalibration();
    console.log('Updated Calibration State:', JSON.stringify(updatedCal.confidenceLevels['High'], null, 2));

    // Verify stats changed
    const highStats = updatedCal.confidenceLevels['High'];
    if (highStats.total > 0 && highStats.wins > 0) {
        console.log('✅ In-memory update verified.');
    } else {
        console.error('❌ In-memory update FAILED.');
        process.exit(1);
    }

    // Verify it wrote to "disk"
    if (mockStorage['learning_state.json']) {
        console.log('✅ File write verified.');
    } else {
        console.error('❌ File write FAILED.');
        process.exit(1);
    }

    console.log('\n3. Verifying Persistence (Reloading)...');

    // To simulate reload, we can't easily destroy the singleton instance in the same process 
    // without implementing a dedicated "reset" or "reload" that forces a read.
    // Fortunately, we implemented loadLearningState public method.

    // First, let's tamper with the in-memory state to prove reload overwrites it or restores it.
    // But we can't easily mutate private state.
    // Instead, rely on loadLearningState reading from our mockStorage.

    // Let's modify the file on disk manually to see if it loads the NEW value
    const diskData = JSON.parse(mockStorage['learning_state.json']);
    diskData.confidenceLevels['High'].wins = 999;
    mockStorage['learning_state.json'] = JSON.stringify(diskData);

    await GlobalLearningService.loadLearningState();

    const reloadedCal = GlobalLearningService.getCalibration();
    if (reloadedCal.confidenceLevels['High'].wins === 999) {
        console.log('✅ Persistence verified: Data loaded from filesystem.');
    } else {
        console.error('❌ Persistence FAILED: Did not load updated data from disk.');
        console.log('Current wins:', reloadedCal.confidenceLevels['High'].wins);
        process.exit(1);
    }

    console.log('\n--- Persistence Check PASSED ---');
}

validatePersistence().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
