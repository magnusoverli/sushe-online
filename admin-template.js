// admin-template.js
const { headerComponent } = require('./templates');

const adminTemplate = (req, data) => {
  const { users, stats, recentActivity, flash } = data;
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Dashboard - SuShe</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <link href="/styles/output.css" rel="stylesheet">
        <style>
            .admin-card {
                background: linear-gradient(145deg, #1a1a1a, #2d2d2d);
                border: 1px solid #333;
            }
            .stat-card {
                background: linear-gradient(145deg, #0f0f0f, #1f1f1f);
            }
        </style>
    </head>
    <body class="bg-black text-gray-300">
        ${headerComponent(req.user, 'admin')}

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

            <!-- Stats Overview -->
            <div class="flex flex-wrap gap-4 mb-8">
                <div class="stat-card rounded-lg px-4 py-3 flex-1 min-w-[150px]">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-xs">Total Users</p>
                            <p class="text-2xl font-bold text-white">${stats.totalUsers}</p>
                        </div>
                        <i class="fas fa-users text-blue-500 text-xl opacity-50"></i>
                    </div>
                </div>
                <div class="stat-card rounded-lg px-4 py-3 flex-1 min-w-[150px]">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-xs">Total Lists</p>
                            <p class="text-2xl font-bold text-white">${stats.totalLists}</p>
                        </div>
                        <i class="fas fa-list text-green-500 text-xl opacity-50"></i>
                    </div>
                </div>
                <div class="stat-card rounded-lg px-4 py-3 flex-1 min-w-[150px]">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-xs">Total Albums</p>
                            <p class="text-2xl font-bold text-white">${stats.totalAlbums}</p>
                        </div>
                        <i class="fas fa-compact-disc text-purple-500 text-xl opacity-50"></i>
                    </div>
                </div>
                <div class="stat-card rounded-lg px-4 py-3 flex-1 min-w-[150px]">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-xs">Admin Users</p>
                            <p class="text-2xl font-bold text-white">${stats.adminUsers}</p>
                        </div>
                        <i class="fas fa-crown text-yellow-500 text-xl opacity-50"></i>
                    </div>
                </div>
            </div>

            <!-- Recent Activity -->
            <div class="admin-card rounded-lg p-6 mb-8">
                <h2 class="text-xl font-semibold mb-4 flex items-center">
                    <i class="fas fa-clock mr-2 text-gray-500"></i>
                    Recent Activity
                </h2>
                <div class="space-y-2">
                    ${recentActivity.map(activity => `
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
            <div class="admin-card rounded-lg p-6">
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
                            ${users.map(user => `
                                <tr class="border-b border-gray-800 hover:bg-gray-900/50">
                                    <td class="py-3">${user.email}</td>
                                    <td class="py-3">${user.username}</td>
                                    <td class="py-3">
                                        ${user.role === 'admin' ? 
                                            '<span class="text-xs bg-yellow-600/20 text-yellow-500 px-2 py-1 rounded">Admin</span>' : 
                                            '<span class="text-xs bg-gray-600/20 text-gray-400 px-2 py-1 rounded">User</span>'
                                        }
                                    </td>
                                    <td class="py-3">${user.listCount}</td>
                                    <td class="py-3 text-sm text-gray-500">${new Date(user.createdAt).toLocaleDateString()}</td>
                                    <td class="py-3 text-center">
                                        <div class="flex justify-center space-x-2">
                                            ${user._id !== req.user._id ? `
                                                ${user.role !== 'admin' ? `
                                                    <button onclick="makeAdmin('${user._id}')" 
                                                        class="text-yellow-500 hover:text-yellow-400 text-sm" 
                                                        title="Grant Admin">
                                                        <i class="fas fa-crown"></i>
                                                    </button>
                                                ` : `
                                                    <button onclick="revokeAdmin('${user._id}')" 
                                                        class="text-gray-500 hover:text-gray-400 text-sm" 
                                                        title="Revoke Admin">
                                                        <i class="fas fa-user-minus"></i>
                                                    </button>
                                                `}
                                                <button onclick="confirmDelete('${user._id}', '${user.email}')" 
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
            <div class="mt-8 admin-card rounded-lg p-6">
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

        <!-- Delete Confirmation Modal -->
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

        <script>
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
                    event.target.value = ''; // Reset file input
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
                
                event.target.value = ''; // Reset file input
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
        </script>
    </body>
    </html>
  `;
};

module.exports = { adminTemplate };