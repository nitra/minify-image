const { run } = require('../index');


it('works with async/await', async () => {
  expect.assertions(1);
  const data = await run(["123"]);
  expect(data).toEqual('foo');
});