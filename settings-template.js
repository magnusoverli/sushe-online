// settings-template.js
const { headerComponent } = require('./templates');

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
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <link href="/styles/output.css" rel="stylesheet">
        <style>
            .settings-card {
                background: linear-gradient(145deg, #1a1a1a, #2d2d2d);
                border: 1px solid #333;
            }
            .stat-card {
                background: linear-gradient(145deg, #0f0f0f, #1f1f1f);
                border: 1px solid #2a2a2a;
                transition: all 0.2s ease;
            }

            .stat-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            }
            .tab-active {
                background: linear-gradient(145deg, #1f1f1f, #2a2a2a);
                border-bottom: 2px solid #dc2626;
            }
            
            /* Progress bar */
            .progress-bar {
                background: #0a0a0a;
                border-radius: 9999px;
                height: 8px;
                overflow: hidden;
            }
            .progress-fill {
                background: #dc2626;
                height: 100%;
                border-radius: 9999px;
                transition: width 0.3s ease;
            }
            
            /* Trend indicators */
            .trend-up { color: #10b981; }
            .trend-down { color: #ef4444; }
            .trend-neutral { color: #6b7280; }
            
            /* User list modal */
            .modal-backdrop {
                backdrop-filter: blur(4px);
            }
            
            /* Toast notifications */
            .toast {
                position: fixed;
                bottom: 2rem;
                right: 2rem;
                background-color: #1f2937;
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 0.5rem;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                transform: translateY(100%);
                opacity: 0;
                transition: all 0.3s ease;
                z-index: 50;
            }
            
            .toast.show {
                transform: translateY(0);
                opacity: 1;
            }
            
            .toast.error {
                background-color: #dc2626;
            }
            
            .toast.success {
                background-color: #059669;
            }
            
            .toast.info {
                background-color: #3b82f6;
            }
            
            /* Action cards */
            .action-card {
                background: linear-gradient(145deg, #0f0f0f, #1f1f1f);
                border: 1px solid #2a2a2a;
                transition: all 0.2s ease;
                cursor: pointer;
            }
            
            .action-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                border-color: #dc2626;
            }
            
            /* Form styling */
            .form-group {
                background: linear-gradient(145deg, #0a0a0a, #1a1a1a);
                border: 1px solid #2a2a2a;
                border-radius: 0.5rem;
                padding: 1rem;
                transition: all 0.2s ease;
            }
            
            .form-group:hover {
                border-color: #3a3a3a;
            }
            
            .form-group:focus-within {
                border-color: #dc2626;
                box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.2);
            }
            
            /* Info cards */
            .info-card {
                background: linear-gradient(145deg, #0f0f0f, #1f1f1f);
                border: 1px solid #2a2a2a;
                padding: 1.5rem;
                border-radius: 0.5rem;
                position: relative;
                overflow: hidden;
            }
            
            .info-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 4px;
                height: 100%;
                background: linear-gradient(to bottom, #dc2626, #7f1d1d);
            }
            
            /* Edit button styling */
            .edit-btn {
                opacity: 0;
                transition: all 0.2s ease;
            }
            
            .info-item:hover .edit-btn {
                opacity: 1;
            }
        </style>
    </head>
    <body class="bg-black text-gray-300">
        ${headerComponent(user, 'settings')}

        <div class="container mx-auto px-4 py-8">
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
                <!-- User Stats Overview -->
                <div class="mb-8">
                    <h2 class="text-xl font-semibold mb-4 flex items-center">
                        <i class="fas fa-chart-line mr-2 text-emerald-500"></i>
                        Your Statistics
                    </h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div class="stat-card rounded-lg px-4 py-3">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-xs">Total Lists</p>
                                    <p class="text-2xl font-bold text-white">${userStats.listCount}</p>
                                    <p class="text-xs text-gray-400 mt-1">Created by you</p>
                                </div>
                                <i class="fas fa-list text-purple-500 text-xl opacity-50"></i>
                            </div>
                        </div>
                        
                        <div class="stat-card rounded-lg px-4 py-3">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-xs">Total Albums</p>
                                    <p class="text-2xl font-bold text-white">${userStats.totalAlbums}</p>
                                    <p class="text-xs text-gray-400 mt-1">In your collection</p>
                                </div>
                                <i class="fas fa-compact-disc text-indigo-500 text-xl opacity-50"></i>
                            </div>
                        </div>
                        
                        <div class="stat-card rounded-lg px-4 py-3">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-xs">Member Since</p>
                                    <p class="text-lg font-bold text-white">${new Date(user.createdAt).getFullYear()}</p>
                                    <p class="text-xs text-gray-400 mt-1">${Math.floor((new Date() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24))} days</p>
                                </div>
                                <i class="fas fa-calendar-alt text-blue-500 text-xl opacity-50"></i>
                            </div>
                        </div>
                        
                        <div class="stat-card rounded-lg px-4 py-3">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-gray-500 text-xs">Account Type</p>
                                    <p class="text-lg font-bold ${isAdmin ? 'text-yellow-500' : 'text-white'}">
                                        ${isAdmin ? 'Admin' : 'User'}
                                    </p>
                                    <p class="text-xs text-gray-400 mt-1">${isAdmin ? 'Full access' : 'Standard access'}</p>
                                </div>
                                <i class="fas ${isAdmin ? 'fa-crown text-yellow-500' : 'fa-user text-gray-500'} text-xl opacity-50"></i>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Account Information Section -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <!-- Personal Information Card -->
                    <div>
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-id-card mr-2 text-blue-500"></i>
                            Personal Information
                        </h2>
                        <div class="info-card">
                            <div class="space-y-4">
                                <div class="info-item">
                                    <label class="block text-gray-500 text-xs uppercase tracking-wider mb-1">Email Address</label>
                                    <div class="flex items-center justify-between group">
                                        <p class="text-white text-lg" id="emailDisplay">${user.email}</p>
                                        <button onclick="editField('email', '${user.email}')" class="edit-btn text-gray-500 hover:text-gray-300 transition-colors ml-2" title="Edit email">
                                            <i class="fas fa-pencil text-sm"></i>
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="info-item">
                                    <label class="block text-gray-500 text-xs uppercase tracking-wider mb-1">Username</label>
                                    <div class="flex items-center justify-between group">
                                        <p class="text-white text-lg" id="usernameDisplay">${user.username}</p>
                                        <button onclick="editField('username', '${user.username}')" class="edit-btn text-gray-500 hover:text-gray-300 transition-colors ml-2" title="Edit username">
                                            <i class="fas fa-pencil text-sm"></i>
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="pt-4 border-t border-gray-800">
                                    <label class="block text-gray-500 text-xs uppercase tracking-wider mb-1">Account Created</label>
                                    <p class="text-white">${new Date(user.createdAt).toLocaleDateString('en-US', { 
                                        year: 'numeric', 
                                        month: 'long', 
                                        day: 'numeric' 
                                    })}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Security Settings Card -->
                    <div>
                        <h2 class="text-xl font-semibold mb-4 flex items-center mt-8 lg:mt-0">
                            <i class="fas fa-shield-alt mr-2 text-green-500"></i>
                            Security Settings
                        </h2>
                        <div class="settings-card rounded-lg p-6">
                            <form method="post" action="/settings/change-password" class="space-y-4">
                                <div class="form-group">
                                    <label class="block text-gray-400 text-xs uppercase tracking-wider mb-2" for="currentPassword">
                                        Current Password
                                    </label>
                                    <input 
                                        type="password" 
                                        id="currentPassword"
                                        name="currentPassword"
                                        class="w-full px-3 py-2 bg-gray-900 border-0 text-white placeholder-gray-600 focus:outline-none"
                                        placeholder="Enter current password"
                                        required
                                    />
                                </div>
                                
                                <div class="form-group">
                                    <label class="block text-gray-400 text-xs uppercase tracking-wider mb-2" for="newPassword">
                                        New Password
                                    </label>
                                    <input 
                                        type="password" 
                                        id="newPassword"
                                        name="newPassword"
                                        class="w-full px-3 py-2 bg-gray-900 border-0 text-white placeholder-gray-600 focus:outline-none"
                                        placeholder="Enter new password"
                                        required
                                        minlength="8"
                                    />
                                </div>
                                
                                <div class="form-group">
                                    <label class="block text-gray-400 text-xs uppercase tracking-wider mb-2" for="confirmPassword">
                                        Confirm New Password
                                    </label>
                                    <input 
                                        type="password" 
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        class="w-full px-3 py-2 bg-gray-900 border-0 text-white placeholder-gray-600 focus:outline-none"
                                        placeholder="Confirm new password"
                                        required
                                        minlength="8"
                                    />
                                </div>
                                
                                <button 
                                    type="submit"
                                    class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded transition duration-200 transform hover:scale-105"
                                >
                                    <i class="fas fa-key mr-2"></i>Update Password
                                </button>
                            </form>
                        </div>
                    </div>
                </div>

                <!-- Quick Actions Section -->
                <div class="mb-8">
                    <h2 class="text-xl font-semibold mb-4 flex items-center">
                        <i class="fas fa-bolt mr-2 text-yellow-500"></i>
                        Quick Actions
                    </h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div class="action-card rounded-lg p-4" onclick="window.location.href='/'">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-white font-semibold">My Lists</p>
                                    <p class="text-xs text-gray-400 mt-1">View and manage your album lists</p>
                                </div>
                                <i class="fas fa-arrow-right text-gray-500 text-lg"></i>
                            </div>
                        </div>
                        
                        <div class="action-card rounded-lg p-4" onclick="window.location.href='/logout'">
                            <div class="flex items-center justify-between">
                                <div>
                                    <p class="text-white font-semibold">Sign Out</p>
                                    <p class="text-xs text-gray-400 mt-1">Log out of your account</p>
                                </div>
                                <i class="fas fa-sign-out-alt text-gray-500 text-lg"></i>
                            </div>
                        </div>
                        
                        ${!isAdmin ? `
                            <div class="action-card rounded-lg p-4" onclick="document.getElementById('adminAccessSection').scrollIntoView({ behavior: 'smooth' })">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-white font-semibold">Request Admin</p>
                                        <p class="text-xs text-gray-400 mt-1">Get administrator access</p>
                                    </div>
                                    <i class="fas fa-crown text-gray-500 text-lg"></i>
                                </div>
                            </div>
                        ` : `
                            <div class="action-card rounded-lg p-4" onclick="showTab('admin')">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-white font-semibold">Admin Panel</p>
                                        <p class="text-xs text-gray-400 mt-1">Manage users and system</p>
                                    </div>
                                    <i class="fas fa-cog text-gray-500 text-lg"></i>
                                </div>
                            </div>
                        `}
                    </div>
                </div>

                <!-- Request Admin Access (only show if not already admin) -->
                ${!isAdmin ? `
                    <div id="adminAccessSection">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-crown mr-2 text-orange-500"></i>
                            Administrator Access
                        </h2>
                        <div class="settings-card rounded-lg p-6">
                            <div class="stat-card rounded-lg p-4 mb-6">
                                <div class="flex items-start gap-3">
                                    <i class="fas fa-info-circle text-blue-500 text-lg mt-1"></i>
                                    <div>
                                        <p class="text-gray-300 text-sm mb-2">
                                            Administrator access grants full control over the system, including user management and database operations.
                                        </p>
                                        <p class="text-gray-400 text-xs">
                                            To request admin access, you'll need the current admin code from the server console. This code rotates every 5 minutes for security.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            
                            <form method="post" action="/settings/request-admin" class="space-y-4">
                                <div class="form-group">
                                    <label class="block text-gray-400 text-xs uppercase tracking-wider mb-2" for="adminCode">
                                        <i class="fas fa-key mr-1"></i>Admin Access Code
                                    </label>
                                    <input 
                                        type="text" 
                                        id="adminCode"
                                        name="code"
                                        class="w-full px-3 py-3 bg-transparent border-0 text-white placeholder-gray-600 focus:outline-none font-mono uppercase text-xl tracking-widest text-center"
                                        placeholder="XXXXXXXX"
                                        maxlength="8"
                                        required
                                        autocomplete="off"
                                    />
                                    <p class="text-xs text-gray-500 mt-2 text-center">Enter the 8-character code from the server console</p>
                                </div>
                                
                                <button 
                                    type="submit"
                                    class="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
                                >
                                    <i class="fas fa-shield-alt mr-2"></i>Request Admin Access
                                </button>
                            </form>
                        </div>
                    </div>
                ` : ''}
            </div>

            <!-- Admin Tab Content (only for admins) -->
            ${isAdmin ? `
                <div id="adminContent" class="tab-content hidden">
                    <!-- Statistics Section -->
                    <div class="mb-8">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-chart-bar mr-2 text-blue-500"></i>
                            Statistics
                        </h2>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Total Users</p>
                                        <p class="text-2xl font-bold text-white">${stats.totalUsers}</p>
                                        ${stats.userGrowth !== undefined ? `
                                            <p class="text-xs ${stats.userGrowth >= 0 ? 'trend-up' : 'trend-down'} mt-1">
                                                <i class="fas fa-arrow-${stats.userGrowth >= 0 ? 'up' : 'down'} text-xs"></i> 
                                                ${Math.abs(stats.userGrowth)}% this week
                                            </p>
                                        ` : ''}
                                    </div>
                                    <i class="fas fa-users text-blue-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                            
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Active Users (7d)</p>
                                        <p class="text-2xl font-bold text-white">${stats.activeUsers || 0}</p>
                                        <p class="text-xs text-gray-400 mt-1">
                                            ${stats.totalUsers > 0 ? Math.round((stats.activeUsers || 0) / stats.totalUsers * 100) : 0}% of total
                                        </p>
                                    </div>
                                    <i class="fas fa-chart-line text-green-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                            
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Total Lists</p>
                                        <p class="text-2xl font-bold text-white">${stats.totalLists}</p>
                                        <p class="text-xs text-gray-400 mt-1">
                                            ~${stats.totalUsers > 0 ? Math.round(stats.totalLists / stats.totalUsers) : 0} per user
                                        </p>
                                    </div>
                                    <i class="fas fa-list text-purple-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                            
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Total Albums</p>
                                        <p class="text-2xl font-bold text-white">${stats.totalAlbums}</p>
                                        <p class="text-xs text-gray-400 mt-1">
                                            ~${stats.totalLists > 0 ? Math.round(stats.totalAlbums / stats.totalLists) : 0} per list
                                        </p>
                                    </div>
                                    <i class="fas fa-compact-disc text-indigo-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                            
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Database Size</p>
                                        <p class="text-2xl font-bold text-white">${stats.dbSize || 'N/A'}</p>
                                        <p class="text-xs text-gray-400 mt-1">
                                            ${stats.activeSessions || 0} active sessions
                                        </p>
                                    </div>
                                    <i class="fas fa-database text-orange-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Recent Activity Section -->
                    <div class="mb-8">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-clock mr-2 text-amber-500"></i>
                            Recent Activity
                        </h2>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            <!-- Activity Cards -->
                            ${adminData.recentActivity.map(activity => `
                                <div class="stat-card rounded-lg px-4 py-3">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <p class="text-gray-500 text-xs">${activity.time}</p>
                                            <p class="text-base font-medium text-white mt-1">${activity.message}</p>
                                        </div>
                                        <i class="fas ${activity.icon} text-${activity.color}-500 text-xl opacity-50"></i>
                                    </div>
                                </div>
                            `).join('')}
                            
                            <!-- Top Genres Card -->
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between mb-2">
                                    <p class="text-gray-500 text-xs">Top Genres</p>
                                    <i class="fas fa-music text-pink-500 text-xl opacity-50"></i>
                                </div>
                                <div class="space-y-1">
                                    ${stats.topGenres && stats.topGenres.length > 0 ? stats.topGenres.slice(0, 3).map((genre, index) => `
                                        <div class="flex items-center justify-between">
                                            <span class="text-sm text-gray-300 truncate">${index + 1}. ${genre.name || 'Unknown'}</span>
                                            <span class="text-xs text-gray-500">${genre.count}</span>
                                        </div>
                                    `).join('') : '<p class="text-gray-500 text-sm">No data</p>'}
                                </div>
                            </div>
                            
                            <!-- Most Active Users Card -->
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between mb-2">
                                    <p class="text-gray-500 text-xs">Most Active Users</p>
                                    <i class="fas fa-trophy text-yellow-500 text-xl opacity-50"></i>
                                </div>
                                <div class="space-y-1">
                                    ${stats.topUsers && stats.topUsers.length > 0 ? stats.topUsers.slice(0, 3).map((u, index) => `
                                        <div class="flex items-center justify-between">
                                            <span class="text-sm text-gray-300 truncate">${u.username}</span>
                                            <span class="text-xs text-gray-500">${u.listCount}</span>
                                        </div>
                                    `).join('') : '<p class="text-gray-500 text-sm">No data</p>'}
                                </div>
                            </div>
                            
                            <!-- Admin Logs Card -->
                            <div class="stat-card rounded-lg px-4 py-3">
                                <div class="flex items-center justify-between mb-2">
                                    <p class="text-gray-500 text-xs">Latest Admin Action</p>
                                    <i class="fas fa-history text-cyan-500 text-xl opacity-50"></i>
                                </div>
                                <div>
                                    ${stats.adminLogs && stats.adminLogs.length > 0 ? `
                                        <p class="text-sm text-gray-300">${stats.adminLogs[0].action}</p>
                                        <p class="text-xs text-gray-500 mt-1">${stats.adminLogs[0].admin}</p>
                                    ` : '<p class="text-gray-500 text-sm">No actions yet</p>'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- User Management Section -->
                    <div class="settings-card rounded-lg p-6 mb-8">
                        <div class="flex items-center justify-between mb-6">
                            <h2 class="text-xl font-semibold flex items-center">
                                <i class="fas fa-users mr-2 text-purple-500"></i>
                                User Management
                            </h2>
                        </div>
                        
                        <!-- Search Bar -->
                        <div class="mb-4">
                            <input 
                                type="text" 
                                id="userSearch" 
                                placeholder="Search users by email or username..." 
                                onkeyup="filterUsers()"
                                class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                            >
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full" id="usersTable">
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
                                <tbody id="usersTableBody">
                                    ${adminData.users.map(u => `
                                        <tr class="border-b border-gray-800 hover:bg-gray-900/50 user-row">
                                            <td class="py-3 user-email">${u.email}</td>
                                            <td class="py-3 user-username">${u.username}</td>
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
                                                    <button onclick="viewUserLists('${u._id}', '${u.username}')" 
                                                        class="text-blue-500 hover:text-blue-400 text-sm" 
                                                        title="View Lists">
                                                        <i class="fas fa-list"></i>
                                                    </button>
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
                            <p id="noUsersFound" class="hidden text-center text-gray-500 py-4">No users found matching your search.</p>
                        </div>
                    </div>

                    <!-- Admin Actions Section -->
                    <div class="mb-8">
                        <h2 class="text-xl font-semibold mb-4 flex items-center">
                            <i class="fas fa-tools mr-2 text-red-500"></i>
                            Admin Actions
                        </h2>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div class="stat-card rounded-lg px-4 py-3 cursor-pointer hover:scale-105 transition-transform" onclick="backupDatabase()">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Database</p>
                                        <p class="text-lg font-semibold text-white">Backup</p>
                                        <p class="text-xs text-gray-400 mt-1">Download snapshot</p>
                                    </div>
                                    <i class="fas fa-download text-blue-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                            
                            <div class="stat-card rounded-lg px-4 py-3 cursor-pointer hover:scale-105 transition-transform" onclick="document.getElementById('restoreFile').click()">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Database</p>
                                        <p class="text-lg font-semibold text-white">Restore</p>
                                        <p class="text-xs text-gray-400 mt-1">Upload backup</p>
                                    </div>
                                    <i class="fas fa-upload text-green-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                            
                            <div class="stat-card rounded-lg px-4 py-3 cursor-pointer hover:scale-105 transition-transform" onclick="clearSessions()">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <p class="text-gray-500 text-xs">Sessions</p>
                                        <p class="text-lg font-semibold text-white">Clear All</p>
                                        <p class="text-xs text-gray-400 mt-1">Force re-login</p>
                                    </div>
                                    <i class="fas fa-broom text-orange-500 text-xl opacity-50"></i>
                                </div>
                            </div>
                        </div>
                        <input type="file" id="restoreFile" accept=".json" style="display: none;" onchange="restoreDatabase(event)">
                    </div>
                </div>
            ` : ''}
        </div>

        <!-- Toast container -->
        <div id="toast" class="toast"></div>

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
            
            <!-- User Lists Modal -->
            <div id="userListsModal" class="hidden fixed inset-0 bg-black/80 modal-backdrop flex items-center justify-center z-50 p-4">
                <div class="bg-gray-900 rounded-lg max-w-2xl w-full max-h-[80vh] border border-gray-700 flex flex-col">
                    <div class="p-6 border-b border-gray-700">
                        <h3 class="text-xl font-semibold text-white">User Lists</h3>
                        <p class="text-sm text-gray-400 mt-1">Viewing lists for: <span id="viewingUsername" class="text-gray-300"></span></p>
                    </div>
                    <div class="flex-1 overflow-y-auto p-6">
                        <div id="userListsContent" class="space-y-3">
                            <!-- Lists will be populated here -->
                        </div>
                    </div>
                    <div class="p-6 border-t border-gray-700">
                        <button onclick="closeUserListsModal()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Close</button>
                    </div>
                </div>
            </div>
        ` : ''}

        <script>
            // Toast notification function
            function showToast(message, type = 'success') {
                const toast = document.getElementById('toast');
                toast.textContent = message;
                toast.className = 'toast ' + type;
                setTimeout(() => toast.classList.add('show'), 10);
                setTimeout(() => {
                    toast.classList.remove('show');
                }, 3000);
            }

            // Check for flash messages and convert to toast on page load
            document.addEventListener('DOMContentLoaded', () => {
                ${flash.success ? `showToast('${flash.success}', 'success');` : ''}
                ${flash.error ? `showToast('${flash.error}', 'error');` : ''}
                ${flash.info ? `showToast('${flash.info}', 'info');` : ''}
            });

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

            // Field editing functionality
            let currentEditField = null;

            function editField(fieldName, currentValue) {
                // Cancel any existing edit
                if (currentEditField) {
                    cancelEdit();
                }
                
                currentEditField = fieldName;
                const displayElement = document.getElementById(fieldName + 'Display');
                const container = displayElement.parentElement;
                
                // Create input field
                const input = document.createElement('input');
                input.type = fieldName === 'email' ? 'email' : 'text';
                input.value = currentValue;
                input.className = 'px-3 py-1 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-red-600 transition duration-200';
                input.id = fieldName + 'Input';
                
                // Create save/cancel buttons
                const buttonContainer = document.createElement('div');
                buttonContainer.className = 'flex gap-2';
                buttonContainer.innerHTML = \`
                    <button onclick="saveField('\${fieldName}')" class="text-green-500 hover:text-green-400 transition-colors" title="Save">
                        <i class="fas fa-check"></i>
                    </button>
                    <button onclick="cancelEdit()" class="text-red-500 hover:text-red-400 transition-colors" title="Cancel">
                        <i class="fas fa-times"></i>
                    </button>
                \`;
                
                // Hide display and pencil, show input
                container.innerHTML = '';
                container.appendChild(input);
                container.appendChild(buttonContainer);
                
                // Focus and select input
                input.focus();
                input.select();
                
                // Handle Enter/Escape keys
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        saveField(fieldName);
                    } else if (e.key === 'Escape') {
                        cancelEdit();
                    }
                });
            }

            function cancelEdit() {
                if (!currentEditField) return;
                
                // Reload to restore original state
                window.location.reload();
            }

            async function saveField(fieldName) {
                const input = document.getElementById(fieldName + 'Input');
                const newValue = input.value.trim();
                
                if (!newValue) {
                    showToast(\`\${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} cannot be empty\`, 'error');
                    return;
                }
                
                // Validation
                if (fieldName === 'email') {
                    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
                    if (!emailRegex.test(newValue)) {
                        showToast('Please enter a valid email address', 'error');
                        return;
                    }
                } else if (fieldName === 'username') {
                    if (newValue.length < 3 || newValue.length > 30) {
                        showToast('Username must be between 3 and 30 characters', 'error');
                        return;
                    }
                    const usernameRegex = /^[a-zA-Z0-9_]+$/;
                    if (!usernameRegex.test(newValue)) {
                        showToast('Username can only contain letters, numbers, and underscores', 'error');
                        return;
                    }
                }
                
                try {
                    const response = await fetch('/settings/update-' + fieldName, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [fieldName]: newValue })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok) {
                        window.location.reload();
                    } else {
                        showToast(result.error || \`Error updating \${fieldName}\`, 'error');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    showToast(\`Error updating \${fieldName}\`, 'error');
                }
            }

            ${isAdmin ? `
                let deleteUserId = null;

                // User search functionality
                function filterUsers() {
                    const searchInput = document.getElementById('userSearch');
                    const filter = searchInput.value.toLowerCase();
                    const rows = document.getElementsByClassName('user-row');
                    const noResults = document.getElementById('noUsersFound');
                    let visibleCount = 0;
                    
                    for (let row of rows) {
                        const email = row.querySelector('.user-email').textContent.toLowerCase();
                        const username = row.querySelector('.user-username').textContent.toLowerCase();
                        
                        if (email.includes(filter) || username.includes(filter)) {
                            row.style.display = '';
                            visibleCount++;
                        } else {
                            row.style.display = 'none';
                        }
                    }
                    
                    // Show/hide no results message
                    if (visibleCount === 0 && filter.length > 0) {
                        document.getElementById('usersTableBody').style.display = 'none';
                        noResults.classList.remove('hidden');
                    } else {
                        document.getElementById('usersTableBody').style.display = '';
                        noResults.classList.add('hidden');
                    }
                }

                // View user lists
                async function viewUserLists(userId, username) {
                    document.getElementById('viewingUsername').textContent = username;
                    document.getElementById('userListsContent').innerHTML = '<p class="text-gray-500">Loading lists...</p>';
                    document.getElementById('userListsModal').classList.remove('hidden');
                    
                    try {
                        const response = await fetch('/admin/user-lists/' + userId);
                        const data = await response.json();
                        
                        if (response.ok) {
                            const content = document.getElementById('userListsContent');
                            if (data.lists && data.lists.length > 0) {
                                content.innerHTML = data.lists.map(list => \`
                                    <div class="bg-gray-800 rounded p-4">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <h4 class="font-semibold text-white">\${list.name}</h4>
                                                <p class="text-sm text-gray-400 mt-1">\${list.albumCount} albums</p>
                                                <p class="text-xs text-gray-500 mt-1">Created: \${new Date(list.createdAt).toLocaleDateString()}</p>
                                            </div>
                                            <div class="text-right">
                                                <p class="text-sm text-gray-400">Last updated</p>
                                                <p class="text-xs text-gray-500">\${new Date(list.updatedAt).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                    </div>
                                \`).join('');
                            } else {
                                content.innerHTML = '<p class="text-gray-500 text-center">This user has no lists yet.</p>';
                            }
                        } else {
                            showToast('Error loading user lists', 'error');
                            closeUserListsModal();
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        showToast('Error loading user lists', 'error');
                        closeUserListsModal();
                    }
                }

                function closeUserListsModal() {
                    document.getElementById('userListsModal').classList.add('hidden');
                }

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
                            showToast('Error deleting user', 'error');
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        showToast('Error deleting user', 'error');
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
                                showToast('Error granting admin privileges', 'error');
                            }
                        } catch (error) {
                            console.error('Error:', error);
                            showToast('Error granting admin privileges', 'error');
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
                                showToast('Error revoking admin privileges', 'error');
                            }
                        } catch (error) {
                            console.error('Error:', error);
                            showToast('Error revoking admin privileges', 'error');
                        }
                    }
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
                            showToast('Database restored successfully! Logging out...', 'success');
                            setTimeout(() => {
                                window.location.href = '/login';
                            }, 2000);
                        } else {
                            showToast(result.error || 'Error restoring database', 'error');
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        showToast('Error restoring database', 'error');
                    }
                    
                    event.target.value = '';
                }

                async function clearSessions() {
                    if (confirm('This will log out all users including yourself. Continue?')) {
                        try {
                            const response = await fetch('/admin/clear-sessions', { method: 'POST' });
                            if (response.ok) {
                                showToast('Sessions cleared. Logging out...', 'success');
                                setTimeout(() => {
                                    window.location.href = '/login';
                                }, 2000);
                            }
                        } catch (error) {
                            console.error('Error:', error);
                            showToast('Error clearing sessions', 'error');
                        }
                    }
                }

                // Click outside to close modals
                window.onclick = function(event) {
                    const deleteModal = document.getElementById('deleteModal');
                    const userListsModal = document.getElementById('userListsModal');
                    
                    if (event.target === deleteModal) {
                        closeDeleteModal();
                    }
                    if (event.target === userListsModal) {
                        closeUserListsModal();
                    }
                }
            ` : ''}
        </script>
    </body>
    </html>
  `;
};

module.exports = { settingsTemplate };