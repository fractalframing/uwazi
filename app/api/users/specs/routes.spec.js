import users_routes from '../routes.js'
import database from '../../utils/database.js'
import fixtures from './fixtures.js'
import fetch from 'isomorphic-fetch'

describe('users routes', () => {

  beforeEach((done) => {
    database.reset_testing_database()
    .then(() => database.import(fixtures))
    .then(() => done())
    .catch(done.fail);
  });

  describe('POST', () => {
    it('should listen /api/users', () => {
      let app = jasmine.createSpyObj('app', ['post']);
      users_routes(app);
      let args = app.post.calls.mostRecent().args;
      expect(args[0]).toBe('/api/users');
    });

    it('should update user matching id and revision preserving all the other properties not sended like username', (done) => {
      let app = jasmine.createSpyObj('app', ['post']);
      users_routes(app);
      let users_post = app.post.calls.mostRecent().args[1];

      let res = {json: function(){}};

      fetch('http://127.0.0.1:5984/uwazi_development/c08ef2532f0bd008ac5174b45e033c93')
      .then(response => response.json())
      .then(user => {
        let req = {body:{"_id":user._id, "_rev":user._rev, "password":"new_password"}};
        users_post(req, res);
      })

      spyOn(res, 'json').and.callFake((response) => {
        expect(response).toBe('');

        fetch('http://127.0.0.1:5984/uwazi_development/c08ef2532f0bd008ac5174b45e033c93')
        .then(response => response.json())
        .then(user => {
          expect(user.password).toBe('new_password');
          expect(user.username).toBe('admin');
          done();
        })
      });

    });
  });
});
