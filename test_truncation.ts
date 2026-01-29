
/**
 * Test script for token truncation logic
 */
import { truncateToTokenLimit, estimateTokenCount } from './utils/tokenUtils';

const mockMessages = [
    { role: 'system', content: 'System Prompt (Keep me)' }, // ~20 chars = 5 tokens
    { role: 'user', content: 'Old message 1' }, // ~13 chars = 4 tokens
    { role: 'assistant', content: 'Old message 2' }, // ~13 chars = 4 tokens
    { role: 'user', content: 'Middle message 3' }, // ~16 chars = 4 tokens
    { role: 'user', content: 'Latest User Message (Keep me)' } // ~29 chars = 8 tokens
];

// Total approx: 5 + 4 + 4 + 4 + 8 = 25 tokens.
// Let's set limit to 15.
// Should keep System (5) + Latest (8) = 13.
// Available = 2.
// Middle messages: Old1(4), Old2(4), Mid3(4).
// Reverse iterate:
// Mid3 (4) > 2? Yes. Drop.
// Old2 (4) > 2? Yes. Drop.
// Old1 (4) > 2? Yes. Drop.
// Expected: System + Latest.

console.log('--- TEST 1: Strict Truncation ---');
const truncated1 = truncateToTokenLimit(mockMessages, 15);
console.log('Result Length:', truncated1.length);
console.log('Result:', JSON.stringify(truncated1, null, 2));

// Test 2: Moderate limit (20)
// Available = 20 - 13 = 7.
// Mid3 (4) <= 7? Yes. Keep. (Used 4)
// Old2 (4) <= 3? No. Drop.
// Old1... Drop.
// Expected: System + Mid3 + Latest.
console.log('\n--- TEST 2: Moderate Truncation ---');
const truncated2 = truncateToTokenLimit(mockMessages, 20);
console.log('Result Length:', truncated2.length);
console.log('Result:', JSON.stringify(truncated2, null, 2));

// Test 3: Large limit (100)
// Expected: All
console.log('\n--- TEST 3: No Truncation ---');
const truncated3 = truncateToTokenLimit(mockMessages, 100);
console.log('Result Length:', truncated3.length);

