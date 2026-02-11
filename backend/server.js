const express = require('express');
const path = require('path');
const cors = require('cors');
const routes = require('./api/routes');
const adminRoutes = require('./api/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// API routes
app.use('/api/admin', adminRoutes);
app.use('/api', routes);

// Serve skill.md documentation
app.get('/skill.md', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'docs', 'skill.md'));
});

// Catch-all: serve landing page (Express 5 wildcard syntax)
app.use(function (req, res, next) {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, function () {
  console.log('');
  console.log('  \x1b[31m███████╗██╗   ██╗██████╗ ██╗   ██╗██╗██╗   ██╗███████╗\x1b[0m');
  console.log('  \x1b[31m██╔════╝██║   ██║██╔══██╗██║   ██║██║██║   ██║██╔════╝\x1b[0m');
  console.log('  \x1b[31m███████╗██║   ██║██████╔╝██║   ██║██║██║   ██║█████╗  \x1b[0m');
  console.log('  \x1b[31m╚════██║██║   ██║██╔══██╗╚██╗ ██╔╝██║╚██╗ ██╔╝██╔══╝  \x1b[0m');
  console.log('  \x1b[31m███████║╚██████╔╝██║  ██║ ╚████╔╝ ██║ ╚████╔╝ ███████╗\x1b[0m');
  console.log('  \x1b[31m╚══════╝ ╚═════╝ ╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═══╝  ╚══════╝\x1b[0m');
  console.log('  \x1b[37m           ╔═══════════════════════════════╗\x1b[0m');
  console.log('  \x1b[37m           ║\x1b[0m  \x1b[37;1mO R   D I E\x1b[0m                  \x1b[37m║\x1b[0m');
  console.log('  \x1b[37m           ╚═══════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  \x1b[32m►\x1b[0m Server:     \x1b[36mhttp://localhost:' + PORT + '\x1b[0m');
  console.log('  \x1b[32m►\x1b[0m API:        \x1b[36mhttp://localhost:' + PORT + '/api\x1b[0m');
  console.log('  \x1b[32m►\x1b[0m Skill Doc:  \x1b[36mhttp://localhost:' + PORT + '/skill.md\x1b[0m');
  console.log('  \x1b[32m►\x1b[0m Status:     \x1b[31mONLINE\x1b[0m | Agents Only | No Humans Allowed');
  console.log('');
});
