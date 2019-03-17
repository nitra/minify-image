const { run } = require('../index')

jest.setTimeout(30000)

it('works with async/await', async () => {
  // expect.assertions(1);
  const data = await run(['--src=.'])
  expect(data).toEqual('success')
})
