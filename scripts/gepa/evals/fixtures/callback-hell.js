// Callback hell example - needs refactoring to async/await
function fetchUserData(userId, callback) {
  getUser(userId, function (err, user) {
    if (err) {
      callback(err);
      return;
    }

    getPosts(user.id, function (err, posts) {
      if (err) {
        callback(err);
        return;
      }

      getComments(posts[0].id, function (err, comments) {
        if (err) {
          callback(err);
          return;
        }

        getLikes(comments[0].id, function (err, likes) {
          if (err) {
            callback(err);
            return;
          }

          callback(null, {
            user: user,
            posts: posts,
            comments: comments,
            likes: likes,
          });
        });
      });
    });
  });
}

// Mock functions
function getUser(id, cb) {
  cb(null, { id, name: 'Test' });
}
function getPosts(userId, cb) {
  cb(null, [{ id: 1, title: 'Post' }]);
}
function getComments(postId, cb) {
  cb(null, [{ id: 1, text: 'Comment' }]);
}
function getLikes(commentId, cb) {
  cb(null, [{ id: 1 }]);
}

module.exports = { fetchUserData };
