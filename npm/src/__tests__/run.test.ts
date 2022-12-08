const { run } = require('../index')

jest.setTimeout(60000)

it('works with async/await', async () => {
  // expect.assertions(1);
  const data = await run(['--src=.', '--write'])
  expect(data).toEqual('success')
})
