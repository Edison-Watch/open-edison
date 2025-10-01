const fs = require('fs');
const path = require('path');

// Fix asset paths in the built HTML file to use the custom app:// protocol
const htmlPath = path.join(__dirname, '..', 'dist', 'src', 'index.html');

if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  
  // Replace absolute asset paths with custom protocol paths
  html = html.replace(/src="\/assets\//g, 'src="app://assets/');
  
  fs.writeFileSync(htmlPath, html);
  console.log('Fixed asset paths in index.html');
} else {
  console.error('HTML file not found:', htmlPath);
}
