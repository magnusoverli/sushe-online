#!/usr/bin/env node

// Simple test script to check if the playlist check endpoint works
const fetch = require('node-fetch');

async function testPlaylistCheck() {
  const baseUrl = 'http://localhost:3000'; // Change if needed
  const listName = 'Test List'; // Change to your test list name

  try {
    // First, you need to be logged in - this is just a test
    console.log('Testing playlist check endpoint...');
    console.log('List name:', listName);
    console.log(
      'URL:',
      `${baseUrl}/api/playlists/${encodeURIComponent(listName)}`
    );

    const response = await fetch(
      `${baseUrl}/api/playlists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add your session cookie here if needed
          // 'Cookie': 'your-session-cookie'
        },
        body: JSON.stringify({ action: 'check' }),
      }
    );

    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers.raw());

    const data = await response.json();
    console.log('Response data:', data);

    if (data.exists !== undefined) {
      console.log('✓ Endpoint is working correctly');
      console.log('Playlist exists:', data.exists);
    } else {
      console.log('✗ Unexpected response format');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testPlaylistCheck();
