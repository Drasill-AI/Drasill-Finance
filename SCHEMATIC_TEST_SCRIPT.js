/**
 * Test Script for Schematic Visualizer
 * 
 * Run this in the browser DevTools console to test the schematic visualizer
 * without needing the Java service or OpenAI integration.
 */

// ============================================
// Test 1: Basic Schematic Tab Opening
// ============================================

console.log('=== Schematic Visualizer Test Suite ===\n');

// Get the store
const store = window.useAppStore?.getState();

if (!store) {
  console.error('❌ Store not found! Make sure app is fully loaded.');
} else {
  console.log('✅ Store found');
}

// Check if openSchematicTab function exists
if (!store?.openSchematicTab) {
  console.error('❌ openSchematicTab function not found!');
} else {
  console.log('✅ openSchematicTab function exists');
}

// ============================================
// Test 2: Open a Mock Schematic Tab
// ============================================

window.testSchematic = async function() {
  console.log('\n--- Test: Opening Mock Schematic Tab ---');
  
  const testData = {
    component_name: 'Hydraulic Pump Assembly',
    machine_model: 'HX-2000',
    additional_context: 'Main pump unit, front left side'
  };
  
  console.log('Test data:', testData);
  
  try {
    const store = window.useAppStore.getState();
    await store.openSchematicTab(testData);
    console.log('✅ Schematic tab opened successfully!');
    console.log('Check the tabs bar - you should see a 🔧 icon tab');
  } catch (error) {
    console.error('❌ Error opening schematic tab:', error);
  }
};

// ============================================
// Test 3: Multiple Schematic Tabs
// ============================================

window.testMultipleSchematics = async function() {
  console.log('\n--- Test: Opening Multiple Schematic Tabs ---');
  
  const components = [
    { component_name: 'Motor Assembly', machine_model: 'M-500' },
    { component_name: 'Circuit Board', machine_model: 'CB-200' },
    { component_name: 'Valve Controller', machine_model: 'VC-100' }
  ];
  
  const store = window.useAppStore.getState();
  
  for (const component of components) {
    console.log(`Opening: ${component.component_name}...`);
    await store.openSchematicTab(component);
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
  }
  
  console.log('✅ All schematic tabs opened!');
};

// ============================================
// Test 4: Check Tab Deduplication
// ============================================

window.testDeduplication = async function() {
  console.log('\n--- Test: Tab Deduplication ---');
  
  const store = window.useAppStore.getState();
  const testData = { component_name: 'Test Component', machine_model: 'TEST-001' };
  
  // Open same schematic twice
  console.log('Opening first tab...');
  await store.openSchematicTab(testData);
  const tabCount1 = store.tabs.filter(t => t.type === 'schematic').length;
  
  console.log('Opening same schematic again...');
  await store.openSchematicTab(testData);
  const tabCount2 = store.tabs.filter(t => t.type === 'schematic').length;
  
  if (tabCount1 === tabCount2) {
    console.log('✅ Deduplication working! Only one tab created.');
  } else {
    console.error('❌ Deduplication failed! Multiple tabs created.');
  }
  
  console.log(`Schematic tabs: ${tabCount2}`);
};

// ============================================
// Test 5: Inspect Current State
// ============================================

window.inspectSchematicState = function() {
  console.log('\n--- Current Schematic State ---');
  
  const store = window.useAppStore.getState();
  const schematicTabs = store.tabs.filter(t => t.type === 'schematic');
  
  console.log(`Total tabs: ${store.tabs.length}`);
  console.log(`Schematic tabs: ${schematicTabs.length}`);
  console.log(`Active tab ID: ${store.activeTabId}`);
  
  if (schematicTabs.length > 0) {
    console.log('\nSchematic Tabs:');
    schematicTabs.forEach((tab, index) => {
      console.log(`  ${index + 1}. ${tab.name}`);
      console.log(`     ID: ${tab.id}`);
      console.log(`     Component: ${tab.schematicData?.componentName}`);
      console.log(`     Model: ${tab.schematicData?.machineModel}`);
    });
  } else {
    console.log('No schematic tabs currently open.');
  }
};

// ============================================
// Test 6: Check API Availability
// ============================================

window.checkSchematicAPI = function() {
  console.log('\n--- Checking Schematic API ---');
  
  const api = window.electronAPI;
  
  if (api.processSchematicToolCall) {
    console.log('✅ processSchematicToolCall available');
  } else {
    console.error('❌ processSchematicToolCall NOT available');
  }
  
  if (api.getSchematicImage) {
    console.log('✅ getSchematicImage available');
  } else {
    console.error('❌ getSchematicImage NOT available');
  }
};

// ============================================
// Test 7: Test with Different Data Types
// ============================================

window.testEdgeCases = async function() {
  console.log('\n--- Test: Edge Cases ---');
  
  const store = window.useAppStore.getState();
  
  // Test 1: Minimal data
  console.log('Test 1: Minimal data (component name only)');
  await store.openSchematicTab({ component_name: 'Simple Component' });
  
  // Test 2: Special characters
  console.log('Test 2: Special characters in name');
  await store.openSchematicTab({ 
    component_name: 'Component #123 (Rev. A)',
    machine_model: 'XYZ-500/A'
  });
  
  // Test 3: Long names
  console.log('Test 3: Long component name');
  await store.openSchematicTab({ 
    component_name: 'Very Long Component Name That Should Be Handled Properly By The UI',
    machine_model: 'LONGMODEL-12345'
  });
  
  console.log('✅ Edge case tests complete');
};

// ============================================
// Instructions
// ============================================

console.log('\n=== Available Test Commands ===');
console.log('Run these commands in the console:\n');
console.log('1. testSchematic()           - Open a single test schematic');
console.log('2. testMultipleSchematics()  - Open multiple schematics');
console.log('3. testDeduplication()       - Test tab deduplication');
console.log('4. inspectSchematicState()   - View current state');
console.log('5. checkSchematicAPI()       - Check API availability');
console.log('6. testEdgeCases()           - Test edge cases\n');
console.log('Quick start: Run testSchematic() to see it in action!');
console.log('\n=======================================\n');

// Auto-run basic checks
checkSchematicAPI();
inspectSchematicState();
