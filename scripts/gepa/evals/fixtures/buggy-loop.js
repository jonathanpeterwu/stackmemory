// Bug: Off-by-one error - processes one too many items
function processItems(items) {
  const results = [];

  // BUG: should be i < items.length, not i <= items.length
  for (let i = 0; i <= items.length; i++) {
    const item = items[i];
    results.push(item.toUpperCase()); // Will crash on undefined
  }

  return results;
}

// Test
const items = ['apple', 'banana', 'cherry'];
console.log(processItems(items)); // Crashes!

module.exports = { processItems };
