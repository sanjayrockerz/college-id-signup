const express = require('express');

const router = express.Router();

router.use((req, res) => {
  res.status(410).json({
    success: false,
    message: 'ID card verification API has been removed',
    path: req.path,
  });
});

module.exports = router;
