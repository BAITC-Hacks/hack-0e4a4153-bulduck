// Compatibility entry point: both commands start the same application.
const { server } = require('../server');
if (require.main === module) {
  server.listen(Number(process.env.PORT) || 3000, () => console.log(`EduTask: http://localhost:${server.address().port}`));
}
module.exports = { server };
