function createResponseHelpers() {
  function respondWithError(req, res, statusCode, message, redirectPath) {
    if (req.accepts('json')) {
      return res.status(statusCode).json({ error: message });
    }

    req.flash('error', message);
    return res.redirect(redirectPath);
  }

  function respondWithSuccess(req, res, message, redirectPath) {
    if (req.accepts('json')) {
      return res.json({ success: true, message });
    }

    req.flash('success', message);
    return res.redirect(redirectPath);
  }

  return {
    respondWithError,
    respondWithSuccess,
  };
}

module.exports = {
  createResponseHelpers,
};
