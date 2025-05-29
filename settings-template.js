// settings-template.js
const settingsTemplate = (req, data) => {
  const { user, stats, userStats, adminData, flash } = data;
  const isAdmin = user.role === 'admin';
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Settings - SuShe</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <style>
            .settings-card {
                background: linear-gradient(145deg, #1a1a1a, #2d2d2d);
                border: 1px solid #333;
            }
            .stat-card {
                background: linear-gradient(145deg, #0f0f0f, #1f1f1f);
            }
            .tab-active {
                background: linear-gradient(145deg, #1f1f1f, #2a2a2a);
                border-bottom: 2px solid #dc2626;
            }
        </style>
    </head>
    <body class="bg-black text-gray-300">
        <!-- Header -->
        <header class="bg-gray-900 border-b border-gray-800 shadow-lg">
            <div class="container mx-auto px-4 py-4">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-4">
                        <a href="/" class="text-xl font-bold text-red-600 hover:text-red-500">SuShe</a>
                        <span class="text-gray-500">/</span>
                        <h1 class="text-xl font-semibold">Settings</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <span class="text-sm text-gray-400">
                            ${isAdmin ? '<i class="fas fa-crown text-yellow-500 mr-2"></i>' : ''}
                            ${user.email}
                        </span>
                        <a href="/" class="text-gray-400 hover:text-white">
                            <i class="fas fa-home text-xl"></i>
                        </a>
                        <a href="/logout" class="text-gray-400 hover:text-red-500">
                            <i class="fas fa-sign-out-alt text-xl"></i>
                        </a>
                    </div>
                </div>
            </div>
        </header>

        <div class="container mx-auto px-4 py-8">
            <!-- Flash Messages -->
            ${flash.success ? `
                <div class="bg-green-900/50 border border-green-600 text-green-400 px-4 py-3 rounded mb-6">
                    <i class="fas fa-check-circle mr-2"></i>${flash.success}
                </div>
            ` : ''}
            ${flash.error ? `
                <div class="bg-red-900/50 border border-red-600 text-red-400 px-4 py-3 rounded mb-6">
                    <i class="fas fa-exclamation-circle mr-2"></i>${flash.error}
                </div>
            ` : ''}

            <!-- Tab Navigation -->
            <div class="settings-card rounded-lg mb-8 p-1">
                <nav class="flex space-x-1">
                    <button onclick="showTab('account')" id="accountTab" class="tab-button flex-1 px-4 py-3 rounded text-sm font-medium transition-all tab-active">
                        <i class="fas fa-user mr-2"></i>Account
                    </button>
                    ${isAdmin ? `
                        <button onclick="showTab('admin')" id="adminTab" class="tab-button flex-1 px-4 py-3 rounded text-sm font-medium transition-all">
                            <i class="fas fa-shield-alt mr-2"></i>Admin Dashboard
                        </button>
                    ` : ''}
                </nav>
            </div>

            <!-- Account Tab Content -->
            <div id="accountContent" class="tab-content">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- Account Information -->
                    <div class="settings-card rounded-lg p-6">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-info-circle mr-2 text-gray-500"></i>
                            Account Information
                        </h2>
                        
                        <div class="space-y-4">
                            <div>
                                <label class="block text-gray-400 text-sm mb-1">Email</label>
                                <p class="text-white">${user.email}</p>
                            </div>
                            
                            <div>
                                <label class="block text-gray-400 text-sm mb-1">Username</label>
                                <p class="text-white">${user.username}</p>
                            </div>
                            
                            <div>
                                <label class="block text-gray-400 text-sm mb-1">Member Since</label>
                                <p class="text-white">${new Date(user.createdAt).toLocaleDateString('en-US', { 
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric' 
                                })}</p>
                            </div>
                            
                            <div class="pt-4 border-t border-gray-700">
                                <label class="block text-gray-400 text-sm mb-1">Your Stats</label>
                                <p class="text-white">${userStats.listCount} lists • ${userStats.totalAlbums} total albums</p>
                            </div>
                            
                            ${isAdmin ? `
                                <div class="pt-4 border-t border-gray-700">
                                    <label class="block text-gray-400 text-sm mb-1">Admin Status</label>
                                    <p class="text-yellow-500">
                                        <i class="fas fa-crown mr-1"></i>
                                        Administrator
                                    </p>
                                    ${user.adminGrantedAt ? `
                                        <p class="text-xs text-gray-500 mt-1">
                                            Granted: ${new Date(user.adminGrantedAt).toLocaleDateString()}
                                        </p>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Change Password -->
                    <div class="settings-card rounded-lg p-6">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-key mr-2 text-gray-500"></i>
                            Change Password
                        </h2>
                        
                        <form method="post" action="/settings/change-password" class="space-y-4">
                            <div>
                                <label class="block text-gray-400 text-sm mb-2" for="currentPassword">
                                    Current Password
                                </label>
                                <input 
                                    type="password" 
                                    id="currentPassword"
                                    name="currentPassword"
                                    class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                                    required
                                />
                            </div>
                            
                            <div>
                                <label class="block text-gray-400 text-sm mb-2" for="newPassword">
                                    New Password
                                </label>
                                <input 
                                    type="password" 
                                    id="newPassword"
                                    name="newPassword"
                                    class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                                    required
                                    minlength="8"
                                />
                            </div>
                            
                            <div>
                                <label class="block text-gray-400 text-sm mb-2" for="confirmPassword">
                                    Confirm New Password
                                </label>
                                <input 
                                    type="password" 
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                                    required
                                    minlength="8"
                                />
                            </div>
                            
                            <button 
                                type="submit"
                                class="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded transition duration-200"
                            >
                                Update Password
                            </button>
                        </form>
                    </div>
                </div>

                <!-- Request Admin Access (only show if not already admin) -->
                ${!isAdmin ? `
                    <div class="settings-card rounded-lg p-6 mt-8">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-crown mr-2 text-gray-500"></i>
                            Request Admin Access
                        </h2>
                        
                        <div class="bg-gray-800/50 border border-gray-700 rounded p-4 mb-4">
                            <p class="text-gray-300 text-sm mb-2">
                                If you have server access, you can request admin privileges by entering the current admin code from the console.
                            </p>
                            <p class="text-gray-400 text-xs">
                                The code is displayed in the server console and rotates every 5 minutes.
                            </p>
                        </div>
                        
                        <form method="post" action="/settings/request-admin" class="space-y-4">
                            <div>
                                <label class="block text-gray-400 text-sm mb-2" for="adminCode">
                                    Admin Code
                                </label>
                                <input 
                                    type="text" 
                                    id="adminCode"
                                    name="code"
                                    class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200 font-mono uppercase text-lg tracking-wider"
                                    placeholder="XXXXXXXX"
                                    maxlength="8"
                                    required
                                    autocomplete="off"
                                />
                                <p class="text-xs text-gray-500 mt-1">Enter the 8-character code from the server console</p>
                            </div>
                            
                            <button 
                                type="submit"
                                class="bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded transition duration-200"
                            >
                                Become Admin
                            </button>
                        </form>
                    </div>
                ` : ''}
            </div>

            <!-- Admin Tab Content (only for admins) -->
            ${isAdmin ? `
                <div id="adminContent" class="tab-content hidden">
                    <!-- Stats Overview -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <div class="stat-card rounded-lg p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-sm">Total Users</p>
                                    <p class="text-3xl font-bold text-white">${stats.totalUsers}</p>
                                </div>
                                <i class="fas fa-users text-blue-500 text-3xl opacity-50"></i>
                            </div>
                        </div>
                        <div class="stat-card rounded-lg p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-sm">Total Lists</p>
                                    <p class="text-3xl font-bold text-white">${stats.totalLists}</p>
                                </div>
                                <i class="fas fa-list text-green-500 text-3xl opacity-50"></i>
                            </div>
                        </div>
                        <div class="stat-card rounded-lg p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-sm">Total Albums</p>
                                    <p class="text-3xl font-bold text-white">${stats.totalAlbums}</p>
                                </div>
                                <i class="fas fa-compact-disc text-purple-500 text-3xl opacity-50"></i>
                            </div>
                        </div>
                        <div class="stat-card rounded-lg p-6">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-sm">Admin Users</p>
                                    <p class="text-3xl font-bold text-white">${stats.adminUsers}</p>
                                </div>
                                <i class="fas fa-crown text-yellow-500 text-3xl opacity-50"></i>
                            </div>
                        </div>
                    </div>

                    <!-- Recent Activity -->
                    <div class="settings-card rounded-lg p-6 mb-8">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-clock mr-2 text-gray-500"></i>
                            Recent Activity
                        </h2>
                        <div class="space-y-2">
                            ${adminData.recentActivity.map(activity => `
                                <div class="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                                    <div class="flex items-center space-x-3">
                                        <i class="fas ${activity.icon} text-${activity.color}-500 text-sm"></i>
                                        <span class="text-sm">${activity.message}</span>
                                    </div>
                                    <span class="text-xs text-gray-500">${activity.time}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Users Table -->
                    <div class="settings-card rounded-lg p-6 mb-8">
                        <div class="flex items-center justify-between mb-6">
                            <h2 class="text-xl font-semibold flex items-center">
                                <i class="fas fa-users mr-2 text-gray-500"></i>
                                User Management
                            </h2>
                            <div class="flex space-x-2">
                                <button onclick="exportUsers()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
                                    <i class="fas fa-download mr-2"></i>Export CSV
                                </button>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead>
                                    <tr class="text-left border-b border-gray-700">
                                        <th class="pb-3 text-gray-400">Email</th>
                                        <th class="pb-3 text-gray-400">Username</th>
                                        <th class="pb-3 text-gray-400">Role</th>
                                        <th class="pb-3 text-gray-400">Lists</th>
                                        <th class="pb-3 text-gray-400">Joined</th>
                                        <th class="pb-3 text-gray-400 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${adminData.users.map(u => `
                                        <tr class="border-b border-gray-800 hover:bg-gray-900/50">
                                            <td class="py-3">${u.email}</td>
                                            <td class="py-3">${u.username}</td>
                                            <td class="py-3">
                                                ${u.role === 'admin' ? 
                                                    '<span class="text-xs bg-yellow-600/20 text-yellow-500 px-2 py-1 rounded">Admin</span>' : 
                                                    '<span class="text-xs bg-gray-600/20 text-gray-400 px-2 py-1 rounded">User</span>'
                                                }
                                            </td>
                                            <td class="py-3">${u.listCount}</td>
                                            <td class="py-3 text-sm text-gray-500">${new Date(u.createdAt).toLocaleDateString()}</td>
                                            <td class="py-3 text-center">
                                                <div class="flex justify-center space-x-2">
                                                    ${u._id !== user._id ? `
                                                        ${u.role !== 'admin' ? `
                                                            <button onclick="makeAdmin('${u._id}')" 
                                                                class="text-yellow-500 hover:text-yellow-400 text-sm" 
                                                                title="Grant Admin">
                                                                <i class="fas fa-crown"></i>
                                                            </button>
                                                        ` : `
                                                            <button onclick="revokeAdmin('${u._id}')" 
                                                                class="text-gray-500 hover:text-gray-400 text-sm" 
                                                                title="Revoke Admin">
                                                                <i class="fas fa-user-minus"></i>
                                                            </button>
                                                        `}
                                                        <button onclick="confirmDelete('${u._id}', '${u.email}')" 
                                                            class="text-red-500 hover:text-red-400 text-sm"
                                                            title="Delete User">
                                                            <i class="fas fa-trash"></i>
                                                        </button>
                                                    ` : '<span class="text-gray-600 text-sm">(You)</span>'}
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Database Actions -->
                    <div class="settings-card rounded-lg p-6">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-database mr-2 text-gray-500"></i>
                            Database Actions
                        </h2>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <button onclick="backupDatabase()" class="p-4 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/50 rounded-lg text-blue-400">
                                <i class="fas fa-download text-2xl mb-2"></i>
                                <p class="font-semibold">Backup Database</p>
                                <p class="text-xs text-gray-500 mt-1">Download complete snapshot</p>
                            </button>
                            <button onclick="document.getElementById('restoreFile').click()" class="p-4 bg-green-600/20 hover:bg-green-600/30 border border-green-600/50 rounded-lg text-green-400">
                                <i class="fas fa-upload text-2xl mb-2"></i>
                                <p class="font-semibold">Restore Database</p>
                                <p class="text-xs text-gray-500 mt-1">Upload backup file</p>
                            </button>
                            <button onclick="clearSessions()" class="p-4 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-600/50 rounded-lg text-orange-400">
                                <i class="fas fa-broom text-2xl mb-2"></i>
                                <p class="font-semibold">Clear Sessions</p>
                                <p class="text-xs text-gray-500 mt-1">Force all users to re-login</p>
                            </button>
                        </div>
                        <input type="file" id="restoreFile" accept=".json" style="display: none;" onchange="restoreDatabase(event)">
                    </div>
                </div>
            ` : ''}
        </div>

        <!-- Delete Confirmation Modal -->
        ${isAdmin ? `
            <div id="deleteModal" class="hidden fixed inset-0 bg-black/80 flex items-center justify-center z-50">
                <div class="bg-gray-900 p-6 rounded-lg max-w-md border border-gray-700">
                    <h3 class="text-xl font-semibold mb-4 text-red-500">Confirm Deletion</h3>
                    <p class="text-gray-400 mb-6">Are you sure you want to delete user <span id="deleteUserEmail" class="font-semibold text-white"></span>?</p>
                    <p class="text-sm text-gray-500 mb-6">This will permanently delete the user and all their lists.</p>
                    <div class="flex justify-end space-x-3">
                        <button onclick="closeDeleteModal()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Cancel</button>
                        <button id="confirmDeleteBtn" class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded">Delete User</button>
                    </div>
                </div>
            </div>
        ` : ''}

        <script>
            // Tab switching
            function showTab(tabName) {
                // Hide all content
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.add('hidden');
                });
                
                // Remove active class from all tabs
                document.querySelectorAll('.tab-button').forEach(tab => {
                    tab.classList.remove('tab-active');
                });
                
                // Show selected content and mark tab as active
                document.getElementById(tabName + 'Content').classList.remove('hidden');
                document.getElementById(tabName + 'Tab').classList.add('tab-active');
            }

            ${isAdmin ? `
                let deleteUserId = null;

                function confirmDelete(userId, email) {
                    deleteUserId = userId;
                    document.getElementById('deleteUserEmail').textContent = email;
                    document.getElementById('deleteModal').classList.remove('hidden');
                    
                    document.getElementById('confirmDeleteBtn').onclick = () => deleteUser(userId);
                }

                function closeDeleteModal() {
                    document.getElementById('deleteModal').classList.add('hidden');
                    deleteUserId = null;
                }

                async function deleteUser(userId) {
                    try {
                        const response = await fetch('/admin/delete-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId })
                        });
                        
                        if (response.ok) {
                            window.location.reload();
                        } else {
                            alert('Error deleting user');
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Error deleting user');
                    }
                    closeDeleteModal();
                }

                async function makeAdmin(userId) {
                    if (confirm('Grant admin privileges to this user?')) {
                        try {
                            const response = await fetch('/admin/make-admin', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId })
                            });
                            
                            if (response.ok) {
                                window.location.reload();
                            } else {
                                alert('Error granting admin privileges');
                            }
                        } catch (error) {
                            console.error('Error:', error);
                            alert('Error granting admin privileges');
                        }
                    }
                }

                async function revokeAdmin(userId) {
                    if (confirm('Revoke admin privileges from this user?')) {
                        try {
                            const response = await fetch('/admin/revoke-admin', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId })
                            });
                            
                            if (response.ok) {
                                window.location.reload();
                            } else {
                                alert('Error revoking admin privileges');
                            }
                        } catch (error) {
                            console.error('Error:', error);
                            alert('Error revoking admin privileges');
                        }
                    }
                }

                async function exportUsers() {
                    window.location.href = '/admin/export-users';
                }

                async function backupDatabase() {
                    window.location.href = '/admin/backup';
                }

                async function restoreDatabase(event) {
                    const file = event.target.files[0];
                    if (!file) return;

                    if (!confirm('WARNING: This will replace ALL current data with the backup. Continue?')) {
                        event.target.value = '';
                        return;
                    }

                    const formData = new FormData();
                    formData.append('backup', file);

                    try {
                        const response = await fetch('/admin/restore', {
                            method: 'POST',
                            body: formData
                        });

                        const result = await response.json();
                        
                        if (response.ok) {
                            alert('Database restored successfully! All users will need to log in again.');
                            window.location.href = '/login';
                        } else {
                            alert(result.error || 'Error restoring database');
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Error restoring database');
                    }
                    
                    event.target.value = '';
                }

                async function clearSessions() {
                    if (confirm('This will log out all users including yourself. Continue?')) {
                        try {
                            const response = await fetch('/admin/clear-sessions', { method: 'POST' });
                            if (response.ok) {
                                alert('Sessions cleared. You will be logged out.');
                                window.location.href = '/login';
                            }
                        } catch (error) {
                            console.error('Error:', error);
                            alert('Error clearing sessions');
                        }
                    }
                }
            ` : ''}
        </script>
    </body>
    </html>
  `;
};

module.exports = { settingsTemplate };