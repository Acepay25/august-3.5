
import { truncateTextToTokens } from './utils/analysisUtils';

const runTest = () => {
    // 1 Token ~= 4 chars
    // Create a string of 100 chars (approx 25 tokens)
    const shortText = "a".repeat(100);

    // Limit to 10 tokens (~40 chars)
    const truncatedShort = truncateTextToTokens(shortText, 10);
    console.log(`Original Length: ${shortText.length}`);
    console.log(`Truncated Length: ${truncatedShort.length}`);
    console.log(`Expected Length: ~40 + suffix`);
    console.log(`Result: ${truncatedShort}`);

    if (truncatedShort.length > 50 && truncatedShort.includes("Truncated")) {
        console.log("TEST 1 PASSED: Truncation applied.");
    } else {
        console.log("TEST 1 FAILED.");
    }

    // Test safe case
    const safeText = "Short text";
    const resultSafe = truncateTextToTokens(safeText, 100);
    if (resultSafe === safeText) {
        console.log("TEST 2 PASSED: No truncation needed.");
    } else {
        console.log("TEST 2 FAILED.");
    }
};

runTest();
